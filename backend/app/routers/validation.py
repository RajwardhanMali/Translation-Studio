"""
Validation router.
POST /validate — validate source text for spelling, grammar, and consistency.
Supports hybrid deterministic + AI-powered validation via `enable_ai` flag.
"""

import logging
from fastapi import APIRouter, HTTPException
from typing import List

from app.models.schemas import ValidateRequest, ValidationResult
from app.services.validator import validate_text, validate_segments
from app.utils.file_handler import load_segmented_document

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/validate", tags=["validation"])


@router.post("", response_model=List[ValidationResult])
async def validate(request: ValidateRequest):
    """
    Validate source content.

    Modes:
    - Provide `document_id` → validate all segments of that document.
    - Provide `text`        → validate a single arbitrary text string.

    Set `auto_fix: true` to receive corrected text alongside issues.
    Set `enable_ai: true` to activate LLM-powered context-aware validation
    (catches grammar in context, wrong-word errors, style issues, and
    cross-document terminology inconsistencies).
    """
    results: List[ValidationResult] = []

    if request.document_id:
        # Validate all segments in the document
        data = load_segmented_document(request.document_id)
        if data is None:
            raise HTTPException(
                status_code=404,
                detail=f"Document '{request.document_id}' not found.",
            )

        raw_results = validate_segments(
            segments=data.get("segments", []),
            auto_fix=request.auto_fix,
            enable_ai=request.enable_ai,
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
        # Validate arbitrary text
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
