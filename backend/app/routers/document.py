"""
Document router.
GET /documents          — list all uploaded documents with progress stats
GET /document/{id}      — retrieve a single parsed document with its blocks
DELETE /document/{id}   — delete a document and all associated data
"""

import logging
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, Integer, or_

from app.database import get_db
from app.models.domain import Document, DocumentCollaborator, Segment
from app.services.collaboration import (
    enrich_collaborator,
    get_current_backend_collaborator,
    require_document_membership,
    require_document_role,
    sync_document_owner_membership,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["documents"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# We will use user_id = None for now, but in Phase 4 we will inject a current user dependency.

# ---------------------------------------------------------------------------
# GET /documents  — dashboard listing
# ---------------------------------------------------------------------------

@router.get("/documents")
async def list_documents(
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    """
    List every document that has been uploaded.
    Returns filename, type, upload date, block count, and translation
    progress (pending / reviewed / approved segment counts + % complete).
    """
    collaborator = enrich_collaborator(db, collaborator)

    collaborator_rows = (
        db.query(DocumentCollaborator)
        .filter(DocumentCollaborator.collaborator_clerk_user_id == collaborator.clerk_user_id)
        .all()
    )
    collaborator_document_ids = list({row.document_id for row in collaborator_rows})

    visibility_filters = [Document.user_id == collaborator.clerk_user_id]
    if collaborator_document_ids:
        visibility_filters.append(Document.id.in_(collaborator_document_ids))

    docs = (
        db.query(Document)
        .filter(or_(*visibility_filters))
        .order_by(Document.created_at.desc())
        .all()
    )
    
    if not docs:
        return []

    for doc in docs:
        sync_document_owner_membership(db, doc.id)

    refreshed_rows = (
        db.query(DocumentCollaborator)
        .filter(DocumentCollaborator.document_id.in_([d.id for d in docs]))
        .filter(DocumentCollaborator.collaborator_clerk_user_id == collaborator.clerk_user_id)
        .all()
    )
    collaborator_map = {row.document_id: row for row in refreshed_rows}

    # 2. Fetch aggregate segment stats in ONE query instead of N+1
    # We group by document_id and count statuses
    stats_query = db.query(
        Segment.document_id,
        func.count(Segment.id).label("total"),
        func.sum(func.cast(Segment.status == "pending", Integer)).label("pending"),
        func.sum(func.cast(Segment.status == "reviewed", Integer)).label("reviewed"),
        func.sum(func.cast(Segment.status == "approved", Integer)).label("approved")
    ).filter(Segment.document_id.in_([d.id for d in docs])).group_by(Segment.document_id).all()

    # Map stats to document_id for easy lookup
    stats_map = {
        s.document_id: {
            "total": s.total or 0,
            "pending": int(s.pending or 0),
            "reviewed": int(s.reviewed or 0),
            "approved": int(s.approved or 0),
        }
        for s in stats_query
    }

    results = []
    for doc in docs:
        st = stats_map.get(doc.id, {"total": 0, "pending": 0, "reviewed": 0, "approved": 0})
        total = st["total"]
        reviewed = st["reviewed"]
        approved = st["approved"]
        
        progress = round((reviewed + approved) / total * 100, 1) if total else 0.0
        
        results.append({
            "id": doc.id,
            "filename": doc.filename,
            "file_type": doc.file_type,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
            "blocks_count": len(doc.blocks) if doc.blocks else 0,
            "segments": st,
            "translation_progress": progress,
            "firebase_url": doc.firebase_url,
            "owner_clerk_user_id": doc.user_id,
            "access_role": "owner" if doc.user_id == collaborator.clerk_user_id else (collaborator_map.get(doc.id).role if collaborator_map.get(doc.id) else "viewer"),
            "is_owner": doc.user_id == collaborator.clerk_user_id,
        })
        
    return results


# ---------------------------------------------------------------------------
# GET /document/{id}  — single document detail
# ---------------------------------------------------------------------------

@router.get("/document/{document_id}")
async def get_document(
    document_id: str,
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    """
    Retrieve a parsed document by its ID.
    Returns the full JSON representation including all blocks.
    """
    collaborator = enrich_collaborator(db, collaborator)
    require_document_membership(db, document_id, collaborator)

    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(
            status_code=404,
            detail=f"Document '{document_id}' not found.",
        )
        
    return {
        "id": doc.id,
        "filename": doc.filename,
        "file_type": doc.file_type,
        "blocks": doc.blocks,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "metadata": doc.metadata_json,
        "firebase_url": doc.firebase_url
    }


# ---------------------------------------------------------------------------
# DELETE /document/{id}  — clean up a document
# ---------------------------------------------------------------------------

@router.delete("/document/{document_id}")
async def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    """
    Delete a document and all its associated data:
    TM entries have foreign key ONDELETE=SET NULL so they are kept.
    Segments have ONDELETE=CASCADE so they are wiped.
    """
    collaborator = enrich_collaborator(db, collaborator)
    require_document_role(db, document_id, collaborator, ["owner"])

    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found.")
        
    db.delete(doc)
    db.commit()
    
    logger.info(f"Deleted document {document_id}")
    return {"document_id": document_id, "deleted": ["document", "segments"]}
