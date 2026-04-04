"""
Upload router.
POST /upload — accepts PDF or DOCX, parses it, classifies it, stores to Firebase and Postgres.
"""

import uuid
import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.domain import Document, Segment
from app.models.schemas import UploadResponse
from app.services.parser import parse_document
from app.services.segmenter import segment_blocks
from app.services.document_classifier import classify_document
from app.utils.file_handler import get_upload_path
from app.utils.firebase_config import upload_file_to_firebase

logger   = logging.getLogger(__name__)
router   = APIRouter(prefix="/upload", tags=["upload"])

ALLOWED_TYPES = {
    "application/pdf":                                                        "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}
ALLOWED_EXTENSIONS = {".pdf": "pdf", ".docx": "docx"}


@router.post("", response_model=UploadResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    # For now, we stub user_id until auth is fully enforced
    # (Phase 4 will add `user_id` extraction from headers to all endpoints)
    user_id = None

    suffix     = Path(file.filename).suffix.lower()
    file_type  = ALLOWED_EXTENSIONS.get(suffix)
    if not file_type:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Allowed: .pdf, .docx",
        )

    document_id = str(uuid.uuid4())
    safe_name   = f"{document_id}{suffix}"
    upload_path = get_upload_path(safe_name)

    try:
        with open(upload_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        logger.info(f"File saved locally: {upload_path}")
    except Exception as e:
        logger.error(f"File save failed: {e}")
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}")

    # Upload to Firebase
    firebase_url = upload_file_to_firebase(str(upload_path), f"documents/{safe_name}")

    try:
        blocks = parse_document(upload_path, document_id, file_type)
    except Exception as e:
        logger.error(f"Parsing failed for {file.filename}: {e}")
        raise HTTPException(status_code=422, detail=f"Document parsing failed: {e}")

    text_sample = " ".join(
        b.get("text", "") for b in blocks
        if b.get("text") and b.get("block_type") not in {"spacer", "table_start", "table_end", "image"}
    )[:2000]

    try:
        classification = classify_document(text_sample)
    except Exception as e:
        logger.warning(f"Document classification failed: {e}")
        classification = {
            "document_type": "general",
            "confidence": 0.0,
            "domain": "general",
            "register": "formal",
        }

    # Extract clean blocks as list of dicts
    clean_blocks = []
    for b in blocks:
        if hasattr(b, 'dict'):
             clean_blocks.append(b.dict())
        elif isinstance(b, dict):
             clean_blocks.append(b)

    # Save Document to PostgreSQL
    new_doc = Document(
        id=document_id,
        user_id=user_id,
        filename=file.filename,
        file_type=file_type,
        firebase_url=firebase_url,
        status="segmented",
        blocks=clean_blocks,
        metadata_json={"classification": classification}
    )
    db.add(new_doc)
    
    try:
        segments = segment_blocks(blocks)
    except Exception as e:
        logger.error(f"Segmentation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {e}")

    # Save Segments to PostgreSQL
    db_segments = []
    for s in segments:
        pos = s.get("position", {})
        if hasattr(pos, 'dict'):
            pos = pos.dict()

        fmt = s.get("format_snapshot", {})
        
        db_seg = Segment(
            id=s.get("id"),
            document_id=document_id,
            user_id=user_id,
            text=s.get("text", ""),
            type=s.get("type", "paragraph"),
            block_type=s.get("block_type", "paragraph"),
            row=s.get("row"),
            col=s.get("col"),
            table_index=s.get("table_index"),
            row_count=s.get("row_count"),
            col_count=s.get("col_count"),
            col_widths=s.get("col_widths"),
            parent_id=s.get("parent_id"),
            position=pos,
            format_snapshot=fmt
        )
        db_segments.append(db_seg)

    db.add_all(db_segments)
    
    try:
        db.commit()
        logger.info(f"Saved Document and {len(db_segments)} Segments to Postgres.")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to save to Postgres: {e}")
        raise HTTPException(status_code=500, detail="Database save failed.")

    return UploadResponse(
        document_id=document_id,
        filename=file.filename,
        file_type=file_type,
        blocks_parsed=len(blocks),
        document_type=classification.get("document_type"),
        domain=classification.get("domain"),
        doc_register=classification.get("register"),
        message=f"Uploaded and segmented {len(segments)} items. Firebase: {bool(firebase_url)}"
    )
