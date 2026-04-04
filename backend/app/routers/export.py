"""
Export router.
POST /export/{document_id}  — regenerate and download the translated document.
GET  /export/status/{document_id} — check if export is ready / translation complete.
"""

import logging
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.domain import Document, Segment as SegmentDB
from app.services.regenerator import regenerate_document

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/export", tags=["export"])

@router.get("/status/{document_id}")
async def export_status(document_id: str, db: Session = Depends(get_db)):
    """
    Returns translation completeness stats.
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found.")
        
    db_segments = db.query(SegmentDB).filter(SegmentDB.document_id == document_id).all()
    
    segments = [s for s in db_segments if s.status != "skip"]
    total    = len(segments)
    pending  = sum(1 for s in segments if s.status == "pending")
    reviewed = sum(1 for s in segments if s.status == "reviewed")
    approved = sum(1 for s in segments if s.status == "approved")
    errors   = sum(1 for s in segments if (s.translated_text or "").startswith("[ERROR"))

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

@router.post("/{document_id}")
async def export_document(
    document_id: str,
    format: Optional[str] = Query("same", description="Output format"),
    include_untranslated: bool = Query(False, description="If True, untranslated segments use original source text."),
    db: Session = Depends(get_db)
):
    """
    Regenerate the translated document and return it as a download.
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found.")
        
    db_segments = db.query(SegmentDB).filter(SegmentDB.document_id == document_id).all()
    if not db_segments:
        raise HTTPException(status_code=404, detail=f"Segments for '{document_id}' not found.")

    translatable = [s for s in db_segments if s.status != "skip"]
    translated   = [s for s in translatable if s.translated_text or s.final_text]

    if not translated:
        raise HTTPException(status_code=400, detail="No translated segments found. Run POST /translate first.")

    pending = [s for s in translatable if not s.translated_text and not s.final_text]
    if pending and not include_untranslated:
        logger.warning(f"Export {document_id}: {len(pending)} untranslated segments will use original source text.")

    if format not in ("same", "docx", "pdf"):
        raise HTTPException(status_code=400, detail=f"Invalid format '{format}'. Use: same | docx | pdf")

    # Reconstruct dictionary forms for regenerator
    parsed_doc = {
        "id": doc.id,
        "filename": doc.filename,
        "file_type": doc.file_type,
        "blocks": doc.blocks,
        "metadata": doc.metadata_json or {}
    }
    
    segments_list = []
    for s in db_segments:
        segments_list.append({
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
            "row": s.row,
            "col": s.col,
            "table_index": s.table_index,
            "row_count": s.row_count,
            "col_count": s.col_count,
            "col_widths": s.col_widths,
        })

    try:
        output_path = regenerate_document(
            document_id=document_id,
            parsed_doc=parsed_doc,
            segments=segments_list,
            output_format=format,
        )
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Regeneration failed for {document_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Regeneration failed: {e}")

    if not output_path.exists():
        raise HTTPException(status_code=500, detail="Regenerated file not found on disk.")

    suffix   = output_path.suffix.lower()
    mime_map = {".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".pdf":  "application/pdf"}
    media_type = mime_map.get(suffix, "application/octet-stream")

    logger.info(f"Serving export: {output_path.name} ({media_type})")
    return FileResponse(
        path=str(output_path),
        media_type=media_type,
        filename=output_path.name,
        headers={"Content-Disposition": f'attachment; filename="{output_path.name}"'},
    )