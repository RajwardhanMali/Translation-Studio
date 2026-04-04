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
from app.models.domain import Document, Segment as SegmentDB
from app.models.schemas import Segment, ApproveRequest, ApproveResponse
from app.services.learning import on_segment_approved

logger = logging.getLogger(__name__)
router = APIRouter(tags=["review"])

@router.get("/segments/{document_id}", response_model=List[Segment])
async def get_segments(
    document_id: str,
    status: Optional[str] = Query(None, description="Filter by status: pending | reviewed | approved"),
    seg_type: Optional[str] = Query(None, alias="type", description="Filter by type"),
    db: Session = Depends(get_db)
):
    """
    Retrieve all segments for a document.
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found.")

    query = db.query(SegmentDB).filter(SegmentDB.document_id == document_id)
    if status:
        query = query.filter(SegmentDB.status == status)
    if seg_type:
        query = query.filter(SegmentDB.type == seg_type)
        
    db_segments = query.all()
    
    # We order by position manually if needed, or assume they are ordered
    results = []
    for s in db_segments:
        results.append(Segment(
            id=s.id,
            document_id=s.document_id,
            text=s.text,
            translated_text=s.translated_text,
            correction=s.correction,
            final_text=s.final_text,
            status=s.status,
            type=s.type,
            parent_id=s.parent_id,
            block_type=s.block_type,
            position=s.position,
            format_snapshot=s.format_snapshot,
            tm_match_type=s.tm_match_type,
            tm_score=s.tm_score,
            row=s.row,
            col=s.col,
            table_index=s.table_index,
            row_count=s.row_count,
            col_count=s.col_count,
            col_widths=s.col_widths,
            created_at=s.created_at.isoformat() if s.created_at else None,
            updated_at=s.updated_at.isoformat() if s.updated_at else None,
        ))
        
    return results


@router.post("/approve", response_model=ApproveResponse)
async def approve_segment(request: ApproveRequest, db: Session = Depends(get_db)):
    """
    Approve a segment.
    """
    seg = db.query(SegmentDB).filter(SegmentDB.id == request.segment_id).first()
    if not seg:
        raise HTTPException(status_code=404, detail=f"Segment '{request.segment_id}' not found.")

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
    target_language = doc.metadata_json.get("target_language", "fr") if doc.metadata_json else "fr"
    
    db.commit()

    if request.approved:
        # Construct dictionary representation for learning service
        seg_dict = {
            "id": seg.id,
            "text": seg.text,
            "translated_text": seg.translated_text,
            "final_text": seg.final_text,
            "correction": seg.correction,
            "status": seg.status,
            "target_language": target_language
        }
        try:
            on_segment_approved(segment=seg_dict, target_language=target_language)
        except Exception as e:
            logger.warning(f"Learning pipeline failed: {e}")

    return ApproveResponse(
        segment_id=request.segment_id,
        status=new_status,
        final_text=final_text,
    )
