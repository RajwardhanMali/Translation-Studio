"""
Review router.
GET  /segments/{doc_id}  — list all segments for a document
POST /approve            — approve (and optionally correct) a segment

Workflow: pending → reviewed → approved
On approval, triggers continuous learning pipeline.
"""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import Segment, ApproveRequest, ApproveResponse
from app.utils.file_handler import (
    load_segmented_document,
    update_segment_in_store,
)
from app.services.learning import on_segment_approved

logger = logging.getLogger(__name__)
router = APIRouter(tags=["review"])


# ---------------------------------------------------------------------------
# GET /segments/{doc_id}
# ---------------------------------------------------------------------------

@router.get("/segments/{document_id}", response_model=List[Segment])
async def get_segments(
    document_id: str,
    status: Optional[str] = Query(
        None,
        description="Filter by status: pending | reviewed | approved",
    ),
    seg_type: Optional[str] = Query(
        None,
        alias="type",
        description="Filter by type: sentence | phrase | heading | table_cell",
    ),
):
    """
    Retrieve all segments for a document.
    Optionally filter by status or segment type.
    """
    data = load_segmented_document(document_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Document '{document_id}' not found.",
        )

    segments: List[dict] = data.get("segments", [])

    if status:
        segments = [s for s in segments if s.get("status") == status]
    if seg_type:
        segments = [s for s in segments if s.get("type") == seg_type]

    return [Segment(**s) for s in segments]


# ---------------------------------------------------------------------------
# POST /approve
# ---------------------------------------------------------------------------

@router.post("/approve", response_model=ApproveResponse)
async def approve_segment(request: ApproveRequest):
    """
    Approve a segment.

    - If `correction` is provided, it is stored in the `correction` field
      and used as `final_text`.
    - If no correction, `final_text = translated_text`.
    - Status transitions:  * → approved
    - Triggers continuous learning (FAISS update + JSONL append).
    """
    # Load document
    data = _find_segment_document(request.segment_id)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"Segment '{request.segment_id}' not found in any document.",
        )

    doc_data, segment = data

    # Determine final text
    if request.correction:
        final_text = request.correction
    elif segment.get("correction"):
        final_text = segment["correction"]
    elif segment.get("translated_text"):
        final_text = segment["translated_text"]
    else:
        raise HTTPException(
            status_code=400,
            detail="No translated_text available. Translate the segment first.",
        )

    new_status = "approved" if request.approved else "reviewed"

    updates = {
        "correction": request.correction or segment.get("correction"),
        "final_text": final_text,
        "status":     new_status,
        "updated_at": datetime.utcnow().isoformat(),
    }

    # Persist changes
    success = update_segment_in_store(
        document_id=doc_data["document_id"],
        segment_id=request.segment_id,
        updates=updates,
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update segment.")

    # Trigger continuous learning on approval
    if request.approved:
        updated_segment = {**segment, **updates}
        try:
            on_segment_approved(
                segment=updated_segment,
                # Derive language from doc metadata if stored, else default "fr"
                target_language=doc_data.get("target_language", "fr"),
            )
        except Exception as e:
            logger.warning(f"Learning pipeline failed (non-critical): {e}")

    logger.info(
        f"Segment {request.segment_id} → {new_status}. "
        f"final_text: '{final_text[:50]}'"
    )

    return ApproveResponse(
        segment_id=request.segment_id,
        status=new_status,
        final_text=final_text,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_segment_document(segment_id: str):
    """
    Search all segmented documents on disk to find the one containing segment_id.
    Returns (doc_data_dict, segment_dict) or None.
    """
    from app.utils.file_handler import SEGMENTED_DIR
    import json

    for path in SEGMENTED_DIR.glob("*.json"):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for seg in data.get("segments", []):
                if seg.get("id") == segment_id:
                    return data, seg
        except Exception as e:
            logger.warning(f"Could not read {path}: {e}")

    return None
