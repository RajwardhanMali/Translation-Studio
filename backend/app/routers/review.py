"""
Review router.
GET  /segments/{doc_id}  — list all segments for a document
POST /approve            — approve (and optionally correct) a segment
"""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.domain import Document, Segment as SegmentDB, SegmentAssignment
from app.models.schemas import Segment, ApproveRequest, ApproveResponse
from app.services.collaboration import (
    attach_collaboration_fields,
    enrich_collaborator,
    ensure_collaboration_tables,
    get_assignment_map,
    get_current_backend_collaborator,
    require_document_membership,
    require_document_role,
    require_segment_assignment,
)
from app.services.learning import on_segment_approved
from app.utils.segment_order import sort_segments

logger = logging.getLogger(__name__)
router = APIRouter(tags=["review"])

@router.get("/segments/{document_id}", response_model=List[Segment])
async def get_segments(
    document_id: str,
    status: Optional[str] = Query(None, description="Filter by status: pending | reviewed | approved"),
    seg_type: Optional[str] = Query(None, alias="type", description="Filter by type"),
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    """
    Retrieve all segments for a document.
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found.")
    ensure_collaboration_tables(db)
    membership = require_document_membership(db, document_id, collaborator)
    
    # Owners and Viewers see all segments.
    # Editors see only segments assigned to them.
    is_privileged = membership.role in ["owner", "viewer"]
    
    query = db.query(SegmentDB).filter(SegmentDB.document_id == document_id)
    if status:
        query = query.filter(SegmentDB.status == status)
    if seg_type:
        query = query.filter(SegmentDB.type == seg_type)
        
    if not is_privileged:
        # For editors, only return segments assigned to this specific user.
        query = query.join(
            SegmentAssignment, 
            SegmentDB.id == SegmentAssignment.segment_id
        ).filter(
            SegmentAssignment.assigned_to_clerk_user_id == collaborator.clerk_user_id
        )

    db_segments = sort_segments(query.all())
    
    # We order by position manually if needed, or assume they are ordered
    assignments = get_assignment_map(db, document_id)
    results = []
    for s in db_segments:
        segment_payload = attach_collaboration_fields({
            "id": s.id,
            "document_id": s.document_id,
            "text": s.text,
            "translated_text": s.translated_text,
            "correction": s.correction,
            "final_text": s.final_text,
            "status": s.status,
            "type": s.type,
            "parent_id": s.parent_id,
            "block_type": s.block_type,
            "position": s.position,
            "format_snapshot": s.format_snapshot,
            "tm_match_type": s.tm_match_type,
            "tm_score": s.tm_score,
            "row": s.row,
            "col": s.col,
            "table_index": s.table_index,
            "row_count": s.row_count,
            "col_count": s.col_count,
            "col_widths": s.col_widths,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        }, assignments.get(s.id))
        results.append(Segment(**segment_payload))
        
    return results


@router.post("/approve", response_model=ApproveResponse)
async def approve_segment(
    request: ApproveRequest,
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    """
    Approve a segment.
    """
    seg = db.query(SegmentDB).filter(SegmentDB.id == request.segment_id).first()
    if not seg:
        raise HTTPException(status_code=404, detail=f"Segment '{request.segment_id}' not found.")
    ensure_collaboration_tables(db)
    collaborator = enrich_collaborator(db, collaborator)
    membership = require_document_role(db, seg.document_id, collaborator, ["editor"])
    require_segment_assignment(db, seg.document_id, [seg.id], collaborator, membership)

    if request.correction:
        final_text = request.correction
    elif seg.correction:
        final_text = seg.correction
    elif seg.translated_text:
        final_text = seg.translated_text
    else:
        raise HTTPException(status_code=400, detail="No translated_text available. Translate first.")

    new_status = "approved" if request.approved else "reviewed"
    
    seg.correction = request.correction or seg.correction
    seg.final_text = final_text
    seg.status = new_status
    seg.updated_at = datetime.utcnow()
    
    doc = db.query(Document).filter(Document.id == seg.document_id).first()
    # Read the language that was actually used during translation.
    # Never fall back to a hard-coded language — if unknown, skip TM learning.
    target_language = ""
    if doc and doc.metadata_json:
        target_language = doc.metadata_json.get("target_language", "")
    
    db.commit()

    if request.approved and target_language:
        seg_dict = {
            "id": seg.id,
            "text": seg.text,
            "translated_text": seg.translated_text,
            "final_text": seg.final_text,
            "correction": seg.correction,
            "status": seg.status,
            "document_id": seg.document_id,
            "target_language": target_language,
        }
        try:
            on_segment_approved(segment=seg_dict, target_language=target_language)
        except Exception as e:
            logger.warning(f"Learning pipeline failed: {e}")
    elif request.approved and not target_language:
        logger.warning(
            f"Skipping TM store for segment {request.segment_id}: "
            "no target_language found in document metadata (was document translated?)"
        )

    return ApproveResponse(
        segment_id=request.segment_id,
        status=new_status,
        final_text=final_text,
    )
