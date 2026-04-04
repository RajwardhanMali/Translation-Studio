"""
Upload router.
POST /upload — accepts PDF or DOCX, parses it, classifies it, and stores parsed + segmented data.
"""

import uuid
import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks

from app.models.schemas import UploadResponse
from app.services.parser import parse_document
from app.services.segmenter import segment_blocks
from app.services.document_classifier import classify_document
from app.utils.file_handler import (
    save_parsed_document,
    save_segmented_document,
    get_upload_path,
)

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
):
    """
    Accept a PDF or DOCX file, parse its structure, classify the document type,
    segment it, and persist all representations to disk.

    Returns a document ID that can be used in subsequent API calls.
    """
    # -----------------------------------------------------------------------
    # 1. Validate file type
    # -----------------------------------------------------------------------
    suffix     = Path(file.filename).suffix.lower()
    file_type  = ALLOWED_EXTENSIONS.get(suffix)
    if not file_type:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Allowed: .pdf, .docx",
        )

    # -----------------------------------------------------------------------
    # 2. Save uploaded file
    # -----------------------------------------------------------------------
    document_id = str(uuid.uuid4())
    safe_name   = f"{document_id}{suffix}"
    upload_path = get_upload_path(safe_name)

    try:
        with open(upload_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        logger.info(f"File saved: {upload_path}")
    except Exception as e:
        logger.error(f"File save failed: {e}")
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}")

    # -----------------------------------------------------------------------
    # 3. Parse document
    # -----------------------------------------------------------------------
    try:
        blocks = parse_document(upload_path, document_id, file_type)
    except Exception as e:
        logger.error(f"Parsing failed for {file.filename}: {e}")
        raise HTTPException(status_code=422, detail=f"Document parsing failed: {e}")

    # -----------------------------------------------------------------------
    # 3.5. Classify document type (1 LLM call)
    # -----------------------------------------------------------------------
    # Extract text sample from first blocks for classification
    text_sample = " ".join(
        b.get("text", "") for b in blocks
        if b.get("text") and b.get("block_type") not in {"spacer", "table_start", "table_end", "image"}
    )[:2000]

    try:
        classification = classify_document(text_sample)
        logger.info(
            f"Document classified: type={classification['document_type']}, "
            f"domain={classification['domain']}, confidence={classification['confidence']:.2f}"
        )
    except Exception as e:
        logger.warning(f"Document classification failed (non-critical): {e}")
        classification = {
            "document_type": "general",
            "confidence": 0.0,
            "domain": "general",
            "register": "formal",
            "domain_keywords": [],
        }

    # -----------------------------------------------------------------------
    # 4. Save parsed document with classification metadata
    # -----------------------------------------------------------------------
    parsed_doc = {
        "id":        document_id,
        "filename":  file.filename,
        "file_type": file_type,
        "blocks":    blocks,
        "metadata":  {
            "classification": classification,
        },
    }
    save_parsed_document(document_id, parsed_doc)
    logger.info(f"Parsed {len(blocks)} blocks from '{file.filename}'")

    # -----------------------------------------------------------------------
    # 5. Segment document
    # -----------------------------------------------------------------------
    try:
        segments = segment_blocks(blocks)
    except Exception as e:
        logger.error(f"Segmentation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {e}")

    segmented_doc = {
        "document_id": document_id,
        "segments":    segments,
        "metadata":    {
            "classification": classification,
        },
    }
    save_segmented_document(document_id, segmented_doc)
    logger.info(f"Segmented into {len(segments)} segments.")

    return UploadResponse(
        document_id=document_id,
        filename=file.filename,
        file_type=file_type,
        blocks_parsed=len(blocks),
        document_type=classification.get("document_type"),
        domain=classification.get("domain"),
        doc_register=classification.get("register"),
        message=(
            f"Document uploaded and processed successfully. "
            f"{len(segments)} segments created. "
            f"Classified as: {classification['document_type']} ({classification['domain']})"
        ),
    )
