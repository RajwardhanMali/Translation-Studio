"""
Export router.
POST /export/{document_id}  — regenerate and download the translated document.
GET  /export/status/{document_id} — check if export is ready / translation complete.
"""

import logging
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.utils.file_handler import (
    load_parsed_document,
    load_segmented_document,
    EXPORTS_DIR,
)
from app.services.regenerator import regenerate_document

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/export", tags=["export"])


# ---------------------------------------------------------------------------
# GET /export/status/{document_id}
# ---------------------------------------------------------------------------

@router.get("/status/{document_id}")
async def export_status(document_id: str):
    """
    Returns translation completeness stats and whether the document
    is ready to export (all segments reviewed or approved).
    """
    seg_data = load_segmented_document(document_id)
    if seg_data is None:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found.")

    segments = [s for s in seg_data.get("segments", []) if s.get("status") != "skip"]
    total    = len(segments)
    pending  = sum(1 for s in segments if s.get("status") == "pending")
    reviewed = sum(1 for s in segments if s.get("status") == "reviewed")
    approved = sum(1 for s in segments if s.get("status") == "approved")
    errors   = sum(1 for s in segments if (s.get("translated_text") or "").startswith("[ERROR"))

    translated = reviewed + approved
    progress   = round(translated / total * 100, 1) if total else 0.0
    ready      = pending == 0 and errors == 0

    return {
        "document_id": document_id,
        "total_segments":      total,
        "pending":             pending,
        "reviewed":            reviewed,
        "approved":            approved,
        "translation_errors":  errors,
        "progress_percent":    progress,
        "ready_to_export":     ready,
        "warning": (
            f"{errors} segment(s) failed translation — review before exporting."
            if errors else None
        ),
    }


# ---------------------------------------------------------------------------
# POST /export/{document_id}
# ---------------------------------------------------------------------------

@router.post("/{document_id}")
async def export_document(
    document_id: str,
    format: Optional[str] = Query(
        "same",
        description=(
            "Output format: 'same' (match original), 'docx', or 'pdf'. "
            "PDF output requires ReportLab (pip install reportlab). "
            "For PDFs input, 'docx' output is recommended for best fidelity."
        ),
    ),
    include_untranslated: bool = Query(
        False,
        description="If True, untranslated segments use original source text.",
    ),
):
    """
    Regenerate the translated document and return it as a download.

    The system:
    1. Loads the parsed document (structure + formatting metadata).
    2. Loads all translated segments.
    3. Reconstructs the document, placing translated text back into the
       original layout with preserved formatting.
    4. Returns the file as an attachment download.

    Segment priority: final_text > correction > translated_text > original text
    """
    # Load parsed document
    parsed_doc = load_parsed_document(document_id)
    if parsed_doc is None:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found.")

    # Load segments
    seg_data = load_segmented_document(document_id)
    if seg_data is None:
        raise HTTPException(status_code=404, detail=f"Segments for '{document_id}' not found.")

    segments = seg_data.get("segments", [])

    # Check: are there any translated segments at all?
    translatable = [s for s in segments if s.get("status") != "skip"]
    translated   = [s for s in translatable if s.get("translated_text") or s.get("final_text")]

    if not translated:
        raise HTTPException(
            status_code=400,
            detail="No translated segments found. Run POST /translate first.",
        )

    # If include_untranslated=False, warn about pending segments but proceed
    pending = [s for s in translatable if not s.get("translated_text") and not s.get("final_text")]
    if pending and not include_untranslated:
        logger.warning(
            f"Export {document_id}: {len(pending)} untranslated segments "
            "will use original source text."
        )

    # Validate format param
    if format not in ("same", "docx", "pdf"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid format '{format}'. Use: same | docx | pdf",
        )

    # Run regeneration
    try:
        output_path = regenerate_document(
            document_id=document_id,
            parsed_doc=parsed_doc,
            segments=segments,
            output_format=format,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Regeneration failed for {document_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Regeneration failed: {e}")

    if not output_path.exists():
        raise HTTPException(status_code=500, detail="Regenerated file not found on disk.")

    # Determine MIME type
    suffix   = output_path.suffix.lower()
    mime_map = {".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".pdf":  "application/pdf"}
    media_type = mime_map.get(suffix, "application/octet-stream")

    logger.info(f"Serving export: {output_path.name} ({media_type})")
    return FileResponse(
        path=str(output_path),
        media_type=media_type,
        filename=output_path.name,
        headers={"Content-Disposition": f'attachment; filename="{output_path.name}"'},
    )