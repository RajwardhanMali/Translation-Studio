"""
Validation router.

Endpoints:
  POST /validate              — Validate a document or text for quality issues
  POST /validate/apply-fixes  — Auto-apply AI-suggested fixes to segments
  POST /validate/edit-segment — Manually edit a segment's source text

When validating by document_id, automatically loads document classification
context (type, domain, register) to provide domain-aware validation.
"""

import logging
from fastapi import APIRouter, HTTPException
from typing import List

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
from app.utils.file_handler import (
    load_segmented_document,
    save_segmented_document,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/validate", tags=["validation"])


# ---------------------------------------------------------------------------
# POST /validate — validate document or text
# ---------------------------------------------------------------------------

@router.post("", response_model=List[ValidationResult])
async def validate(request: ValidateRequest):
    """
    Validate source content for quality issues.

    Modes:
    - Provide `document_id` → validate all segments of that document.
      Automatically loads document classification for context-aware validation.
    - Provide `text` → validate a single arbitrary text string.

    Set `auto_fix: true` to receive auto-corrected text (double spaces only).
    Set `enable_ai: true` to activate LLM-powered comprehensive validation
    (spelling, grammar, consistency, punctuation, formatting).
    """
    results: List[ValidationResult] = []

    if request.document_id:
        data = load_segmented_document(request.document_id)
        if data is None:
            raise HTTPException(
                status_code=404,
                detail=f"Document '{request.document_id}' not found.",
            )

        classification = data.get("metadata", {}).get("classification", {})

        raw_results = validate_segments(
            segments=data.get("segments", []),
            auto_fix=request.auto_fix,
            enable_ai=request.enable_ai,
            document_context=classification if classification else None,
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
async def apply_fixes(request: ApplyFixesRequest):
    """
    Auto-apply AI-suggested fixes to document segments.

    Runs AI validation on the specified segments (or all segments if
    segment_ids is null), then applies the suggested corrections
    directly to the segment text.

    Only applies fixes for issues with severity "error" or "warning".
    The original text is returned alongside the fixed text for review.

    The updated segments are persisted to disk.
    """
    data = load_segmented_document(request.document_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Document '{request.document_id}' not found.",
        )

    segments = data.get("segments", [])
    classification = data.get("metadata", {}).get("classification", {})

    result = apply_ai_fixes(
        segments=segments,
        segment_ids=request.segment_ids,
        document_context=classification if classification else None,
    )

    # Persist updated segments
    save_segmented_document(request.document_id, data)
    logger.info(
        f"Applied AI fixes to {result['fixed_count']} segments "
        f"in doc {request.document_id}"
    )

    return ApplyFixesResponse(
        document_id=request.document_id,
        fixed_count=result["fixed_count"],
        fixes=result["fixes"],
    )


# ---------------------------------------------------------------------------
# POST /validate/edit-segment — manually edit segment text
# ---------------------------------------------------------------------------

@router.post("/edit-segment", response_model=EditSegmentResponse)
async def edit_segment(request: EditSegmentRequest):
    """
    Manually edit a segment's source text.

    Use this when the user wants to correct a flagged segment before
    translation. The segment's status is set to "edited".

    The updated segment is persisted to disk.
    """
    data = load_segmented_document(request.document_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Document '{request.document_id}' not found.",
        )

    segments = data.get("segments", [])

    result = update_segment_text(
        segments=segments,
        segment_id=request.segment_id,
        new_text=request.new_text,
    )

    if result is None:
        raise HTTPException(
            status_code=404,
            detail=f"Segment '{request.segment_id}' not found in document '{request.document_id}'.",
        )

    # Persist
    save_segmented_document(request.document_id, data)
    logger.info(f"Segment {request.segment_id} edited in doc {request.document_id}")

    return EditSegmentResponse(**result)
