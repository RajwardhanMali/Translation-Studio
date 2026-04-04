"""
Translation router — v3.
"""

import logging
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.domain import Document, Segment as SegmentDB
from app.models.schemas import TranslateRequest, TranslateResponse, Segment
from app.utils.embeddings import encode_texts
from app.services.rag_engine import classify_segment, store_translations_batch
from app.services.llm_service import translate_batch, get_backend_info
from app.services.glossary_engine import (
    build_glossary_prompt_fragment,
    get_style_rules,
    enforce_glossary,
)
from app.services.validator import validate_segments

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/translate", tags=["translation"])


@router.get("/info")
async def translation_info():
    return get_backend_info()


@router.post("", response_model=TranslateResponse)
async def translate_document(request: TranslateRequest, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == request.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{request.document_id}' not found.")

    db_segments = db.query(SegmentDB).filter(SegmentDB.document_id == request.document_id).all()
    
    # Convert DB models to dicts for existing logic
    all_segments = []
    for s in db_segments:
        all_segments.append({
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
            "tm_match_type": s.tm_match_type,
            "tm_score": s.tm_score,
            "row": s.row,
            "col": s.col,
            "table_index": s.table_index,
            "row_count": s.row_count,
            "col_count": s.col_count,
            "col_widths": s.col_widths,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        })
        
    target_ids = set(request.segment_ids) if request.segment_ids else None
    effective_rules = request.style_rules or get_style_rules()

    classification = doc.metadata_json.get("classification", {}) if doc.metadata_json else {}
    document_domain = classification.get("domain")
    glossary_fragment = build_glossary_prompt_fragment(
        "", request.target_language, document_domain=document_domain
    )

    if request.pre_validate:
        logger.info(f"Running pre-translation AI validation for doc: {request.document_id}")
        validation_results = validate_segments(
            segments=all_segments,
            auto_fix=False,
            enable_ai=True,
            min_issue_severity="warning",
            document_context=classification,
        )
        logger.info(f"Pre-validation complete: {len(validation_results)} segments with issues")

    # Assuming prev_language was stored in document.metadata_json
    metadata = doc.metadata_json or {}
    prev_language = metadata.get("target_language", "")

    to_translate: List[dict] = []
    for seg in all_segments:
        if target_ids and seg["id"] not in target_ids:
            continue
        if seg.get("status") == "skip":
            continue
        if seg.get("correction"):
            seg["final_text"] = seg["correction"]
            seg["status"]     = "reviewed"
            seg["updated_at"] = datetime.utcnow().isoformat()
            continue

        if prev_language and prev_language.lower() != request.target_language.lower():
            if seg.get("translated_text") and not seg.get("correction"):
                seg["translated_text"] = None
                seg["status"]          = "pending"
                seg["tm_match_type"]   = None
                seg["tm_score"]        = None

        tt = seg.get("translated_text", "") or ""
        if tt and not tt.startswith("[") and tt.strip() != seg.get("text", "").strip():
            continue
        if not seg.get("text", "").strip():
            continue
        to_translate.append(seg)

    logger.info(f"{len(to_translate)} segments need translation (doc: {request.document_id})")

    if not to_translate:
        return TranslateResponse(
            document_id=request.document_id,
            segments_translated=0,
            segments=[Segment(**s) for s in all_segments],
        )

    sources = [s["text"].strip() for s in to_translate]
    try:
        embeddings = encode_texts(sources)
    except Exception as e:
        logger.error(f"Batch embedding failed: {e}")
        embeddings = None

    for i, seg in enumerate(to_translate):
        if embeddings is not None:
            try:
                emb = embeddings[i]
                match_type, tm_translation, score = classify_segment(seg["text"], emb, target_language=request.target_language)
            except Exception as e:
                logger.warning(f"TM classify failed for {seg['id']}: {e}")
                match_type, tm_translation, score = "new", None, 0.0
        else:
            match_type, tm_translation, score = "new", None, 0.0

        seg["tm_match_type"]    = match_type
        seg["tm_score"]         = round(score, 4)
        seg["tm_translation"]   = tm_translation
        seg["glossary_fragment"] = glossary_fragment

    translate_batch(
        segments=to_translate,
        target_language=request.target_language,
        style_rules=effective_rules,
    )

    translated_count = 0
    seg_index = {s["id"]: s for s in all_segments}

    for seg in to_translate:
        raw = seg.get("translated_text", "")
        if not raw or raw.startswith("[ERROR"):
            seg_index[seg["id"]]["translated_text"] = raw
            continue

        corrected, violations = enforce_glossary(
            raw, seg["text"], request.target_language,
            document_domain=document_domain,
        )
        seg_index[seg["id"]]["translated_text"] = corrected
        seg_index[seg["id"]]["status"]          = "reviewed"
        seg_index[seg["id"]]["updated_at"]      = datetime.utcnow().isoformat()
        seg_index[seg["id"]]["tm_match_type"]   = seg["tm_match_type"]
        seg_index[seg["id"]]["tm_score"]        = seg["tm_score"]
        translated_count += 1

    # Update metadata and segments back to DB
    metadata["target_language"] = request.target_language
    doc.metadata_json = metadata

    for db_s in db_segments:
        updated_dict = seg_index.get(db_s.id)
        if updated_dict:
            db_s.translated_text = updated_dict.get("translated_text")
            db_s.correction = updated_dict.get("correction")
            db_s.final_text = updated_dict.get("final_text")
            db_s.status = updated_dict.get("status")
            db_s.tm_match_type = updated_dict.get("tm_match_type")
            db_s.tm_score = updated_dict.get("tm_score")
            db_s.updated_at = datetime.utcnow()

    db.commit()

    try:
        stored = store_translations_batch(
            segments=[s for s in to_translate if not s.get("translated_text", "").startswith("[")],
            target_language=request.target_language,
        )
        logger.info(f"TM auto-populated: {stored} entries added.")
    except Exception as e:
        logger.warning(f"TM auto-populate failed: {e}")

    return TranslateResponse(
        document_id=request.document_id,
        segments_translated=translated_count,
        segments=[Segment(**s) for s in all_segments],
    )
