"""
Validation router.

Endpoints:
  POST /validate              — Validate a document or text for quality issues
  POST /validate/apply-fixes  — Auto-apply AI-suggested fixes to segments
  POST /validate/edit-segment — Manually edit a segment's source text
"""

import logging
from fastapi import APIRouter, HTTPException, Depends
from typing import List
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.domain import Document, Segment as SegmentDB
from app.models.schemas import (
    ValidateRequest,
    ValidationResult,
    ApplyFixesRequest,
    ApplyFixesResponse,
    EditSegmentRequest,
    EditSegmentResponse,
)
from app.services.validator import (
    validate_text,
    validate_segments,
    apply_ai_fixes,
    update_segment_text,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/validate", tags=["validation"])


# ---------------------------------------------------------------------------
# POST /validate — validate document or text
# ---------------------------------------------------------------------------

@router.post("", response_model=List[ValidationResult])
async def validate(request: ValidateRequest, db: Session = Depends(get_db)):
    results: List[ValidationResult] = []

    if request.document_id:
        doc = db.query(Document).filter(Document.id == request.document_id).first()
        if not doc:
            raise HTTPException(status_code=404, detail=f"Document '{request.document_id}' not found.")
            
        db_segments = db.query(SegmentDB).filter(SegmentDB.document_id == request.document_id).all()
        segments_data = [{"id": s.id, "text": s.text} for s in db_segments]

        classification = doc.metadata_json.get("classification", {}) if doc.metadata_json else None

        raw_results = validate_segments(
            segments=segments_data,
            auto_fix=request.auto_fix,
            enable_ai=request.enable_ai,
            min_issue_severity=request.min_issue_severity,
            document_context=classification,
        )
        for r in raw_results:
            results.append(ValidationResult(
                document_id=request.document_id,
                segment_id=r.get("segment_id"),
                text=r["text"],
                issues=r["issues"],
                auto_fixed_text=r.get("auto_fixed_text"),
                has_errors=r["has_errors"],
                has_warnings=r["has_warnings"],
            ))

    elif request.text:
        r = validate_text(
            text=request.text,
            auto_fix=request.auto_fix,
            enable_ai=request.enable_ai,
            min_issue_severity=request.min_issue_severity,
        )
        results.append(ValidationResult(
            text=r["text"],
            issues=r["issues"],
            auto_fixed_text=r.get("auto_fixed_text"),
            has_errors=r["has_errors"],
            has_warnings=r["has_warnings"],
        ))

    else:
        raise HTTPException(
            status_code=400,
            detail="Provide either 'document_id' or 'text' in the request body.",
        )

    return results


# ---------------------------------------------------------------------------
# POST /validate/apply-fixes — auto-apply AI suggestions
# ---------------------------------------------------------------------------

@router.post("/apply-fixes", response_model=ApplyFixesResponse)
async def apply_fixes(request: ApplyFixesRequest, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == request.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{request.document_id}' not found.")

    db_segments = db.query(SegmentDB).filter(SegmentDB.document_id == request.document_id).all()
    segments_data = [{"id": s.id, "text": s.text, "status": s.status} for s in db_segments]
    
    classification = doc.metadata_json.get("classification", {}) if doc.metadata_json else None

    result = apply_ai_fixes(
        segments=segments_data,
        segment_ids=request.segment_ids,
        document_context=classification,
    )

    # Persist updated segments
    for s_data in segments_data:
        # Find matching DB object and update
        for db_s in db_segments:
            if db_s.id == s_data["id"]:
                db_s.text = s_data["text"]
                db_s.status = s_data["status"]
                break
                
    db.commit()
    logger.info(f"Applied AI fixes to {result['fixed_count']} segments in doc {request.document_id}")

    return ApplyFixesResponse(
        document_id=request.document_id,
        fixed_count=result["fixed_count"],
        fixes=result["fixes"],
    )


# ---------------------------------------------------------------------------
# POST /validate/edit-segment — manually edit segment text
# ---------------------------------------------------------------------------

@router.post("/edit-segment", response_model=EditSegmentResponse)
async def edit_segment(request: EditSegmentRequest, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == request.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{request.document_id}' not found.")

    db_segments = db.query(SegmentDB).filter(SegmentDB.document_id == request.document_id).all()
    segments_data = [{"id": s.id, "text": s.text, "status": s.status} for s in db_segments]

    result = update_segment_text(
        segments=segments_data,
        segment_id=request.segment_id,
        new_text=request.new_text,
    )

    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Segment '{request.segment_id}' not found.",
        )

    for db_s in db_segments:
        if db_s.id == request.segment_id:
            db_s.text = request.new_text
            db_s.status = "edited"  # standard behavior from update_segment_text
            break
            
    db.commit()
    logger.info(f"Segment {request.segment_id} edited in doc {request.document_id}")

    return EditSegmentResponse(**result)
