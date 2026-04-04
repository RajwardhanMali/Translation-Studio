"""
Document router.
GET /documents          — list all uploaded documents with progress stats
GET /document/{id}      — retrieve a single parsed document with its blocks
DELETE /document/{id}   — delete a document and all associated data
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.domain import Document, Segment

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
async def list_documents(db: Session = Depends(get_db)):
    """
    List every document that has been uploaded.
    Returns filename, type, upload date, block count, and translation
    progress (pending / reviewed / approved segment counts + % complete).
    """
    docs = db.query(Document).order_by(Document.created_at.desc()).all()
    results = []
    
    for doc in docs:
        segments = db.query(Segment).filter(Segment.document_id == doc.id).all()
        total = len(segments)
        pending = sum(1 for s in segments if s.status == "pending")
        reviewed = sum(1 for s in segments if s.status == "reviewed")
        approved = sum(1 for s in segments if s.status == "approved")
        
        progress = round((reviewed + approved) / total * 100, 1) if total else 0.0
        
        results.append({
            "id": doc.id,
            "filename": doc.filename,
            "file_type": doc.file_type,
            "created_at": doc.created_at.isoformat() if doc.created_at else None,
            "blocks_count": len(doc.blocks) if doc.blocks else 0,
            "segments": {
                "total": total,
                "pending": pending,
                "reviewed": reviewed,
                "approved": approved,
            },
            "translation_progress": progress,
            "firebase_url": doc.firebase_url,
        })
        
    return results


# ---------------------------------------------------------------------------
# GET /document/{id}  — single document detail
# ---------------------------------------------------------------------------

@router.get("/document/{document_id}")
async def get_document(document_id: str, db: Session = Depends(get_db)):
    """
    Retrieve a parsed document by its ID.
    Returns the full JSON representation including all blocks.
    """
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
async def delete_document(document_id: str, db: Session = Depends(get_db)):
    """
    Delete a document and all its associated data:
    TM entries have foreign key ONDELETE=SET NULL so they are kept.
    Segments have ONDELETE=CASCADE so they are wiped.
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found.")
        
    db.delete(doc)
    db.commit()
    
    logger.info(f"Deleted document {document_id}")
    return {"document_id": document_id, "deleted": ["document", "segments"]}