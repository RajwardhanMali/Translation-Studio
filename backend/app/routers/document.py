"""
Document router.
GET /documents          — list all uploaded documents with progress stats
GET /document/{id}      — retrieve a single parsed document with its blocks
DELETE /document/{id}   — delete a document and all associated data
"""

import json
import logging
from fastapi import APIRouter, HTTPException

from app.utils.file_handler import (
    load_parsed_document,
    list_all_documents,
    PARSED_DIR,
    SEGMENTED_DIR,
    UPLOADS_DIR,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["documents"])


# ---------------------------------------------------------------------------
# GET /documents  — dashboard listing
# ---------------------------------------------------------------------------

@router.get("/documents")
async def list_documents():
    """
    List every document that has been uploaded.
    Returns filename, type, upload date, block count, and translation
    progress (pending / reviewed / approved segment counts + % complete).
    """
    return list_all_documents()


# ---------------------------------------------------------------------------
# GET /document/{id}  — single document detail
# ---------------------------------------------------------------------------

@router.get("/document/{document_id}")
async def get_document(document_id: str):
    """
    Retrieve a parsed document by its ID.
    Returns the full JSON representation including all blocks.
    """
    doc = load_parsed_document(document_id)
    if doc is None:
        raise HTTPException(
            status_code=404,
            detail=f"Document '{document_id}' not found.",
        )
    return doc


# ---------------------------------------------------------------------------
# DELETE /document/{id}  — clean up a document
# ---------------------------------------------------------------------------

@router.delete("/document/{document_id}")
async def delete_document(document_id: str):
    """
    Delete a document and all its associated data:
    parsed JSON, segmented JSON, and the original upload file.
    TM entries are kept for future translation memory reuse.
    """
    deleted = []
    not_found = []

    parsed_path = PARSED_DIR / f"{document_id}.json"
    if parsed_path.exists():
        parsed_path.unlink()
        deleted.append("parsed_doc")
    else:
        not_found.append("parsed_doc")

    seg_path = SEGMENTED_DIR / f"{document_id}.json"
    if seg_path.exists():
        seg_path.unlink()
        deleted.append("segmented_doc")
    else:
        not_found.append("segmented_doc")

    for ext in [".pdf", ".docx"]:
        upload_path = UPLOADS_DIR / f"{document_id}{ext}"
        if upload_path.exists():
            upload_path.unlink()
            deleted.append(f"upload{ext}")
            break

    if not deleted:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found.")

    logger.info(f"Deleted document {document_id}: {deleted}")
    return {"document_id": document_id, "deleted": deleted, "not_found": not_found}