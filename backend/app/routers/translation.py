"""
Translation router — v3.

Key changes:
  - After translation, automatically stores results in FAISS TM
    (store_translations_batch) so the TM grows without needing human approval.
  - Uses new translate_batch() which packs multiple segments into each LLM call.
  - Only sentence-type segments are sent to LLM; heading/table_cell segments
    are also translated but kept in separate pass to avoid noise.
"""

import logging
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.models.schemas import TranslateRequest, TranslateResponse, Segment
from app.utils.file_handler import load_segmented_document, save_segmented_document
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
async def translate_document(request: TranslateRequest):
    """
    Translate all (or selected) segments of a document.

    Performance: segments are embedded in one batched call, then translated
    in multi-segment LLM batches (10 per API call by default).
    TM is automatically populated after translation — no human approval needed.
    """
    data = load_segmented_document(request.document_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Document '{request.document_id}' not found.")

    all_segments: List[dict] = data.get("segments", [])
    target_ids = set(request.segment_ids) if request.segment_ids else None
    effective_rules = request.style_rules or get_style_rules()
    glossary_fragment = build_glossary_prompt_fragment("", request.target_language)

    # ── 0. Pre-validation (AI-powered, opt-in) ────────────────────────────
    validation_results = []
    if request.pre_validate:
        logger.info(f"Running pre-translation AI validation for doc: {request.document_id}")
        validation_results = validate_segments(
            segments=all_segments,
            auto_fix=False,
            enable_ai=True,
        )
        data["validation_results"] = validation_results
        logger.info(f"Pre-validation complete: {len(validation_results)} segments with issues")

    # ── 1. Filter segments that need translation ──────────────────────────────
    # Load the language this document was previously translated to (if any)
    prev_language = data.get("target_language", "")

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

        # ── Language-change detection ─────────────────────────────────────
        # If the document was previously translated to a DIFFERENT language,
        # clear the old translation so we go through the LLM again.
        # We do NOT clear human corrections — those are language-agnostic edits.
        if prev_language and prev_language.lower() != request.target_language.lower():
            if seg.get("translated_text") and not seg.get("correction"):
                seg["translated_text"] = None
                seg["status"]          = "pending"
                seg["tm_match_type"]   = None
                seg["tm_score"]        = None

        tt = seg.get("translated_text", "") or ""
        # Skip only if genuinely translated in the right language
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

    # ── 2. Batch embed all source texts at once ───────────────────────────────
    sources = [s["text"].strip() for s in to_translate]
    try:
        embeddings = encode_texts(sources)   # single batched encoder call
        logger.info(f"Embeddings computed: {len(embeddings)} vectors")
    except Exception as e:
        logger.error(f"Batch embedding failed: {e}")
        embeddings = None

    # ── 3. TM classify each segment ───────────────────────────────────────────
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

    # ── 4. Translate in batches ───────────────────────────────────────────────
    translate_batch(
        segments=to_translate,
        target_language=request.target_language,
        style_rules=effective_rules,
    )

    # ── 5. Post-process: glossary enforcement + status update ──────────────────
    translated_count = 0
    seg_index = {s["id"]: s for s in all_segments}

    for seg in to_translate:
        raw = seg.get("translated_text", "")
        if not raw or raw.startswith("[ERROR"):
            seg_index[seg["id"]]["translated_text"] = raw
            continue

        corrected, violations = enforce_glossary(raw, seg["text"], request.target_language)
        if violations:
            logger.info(f"Glossary: {len(violations)} fix(es) on {seg['id']}")

        seg_index[seg["id"]]["translated_text"] = corrected
        seg_index[seg["id"]]["status"]          = "reviewed"
        seg_index[seg["id"]]["updated_at"]      = datetime.utcnow().isoformat()
        seg_index[seg["id"]]["tm_match_type"]   = seg["tm_match_type"]
        seg_index[seg["id"]]["tm_score"]        = seg["tm_score"]
        translated_count += 1

    # ── 6. Persist segments ───────────────────────────────────────────────────
    data["segments"]        = list(seg_index.values())
    data["target_language"] = request.target_language
    save_segmented_document(request.document_id, data)

    # ── 7. Auto-populate TM (no approval needed) ──────────────────────────────
    try:
        stored = store_translations_batch(
            segments=[s for s in to_translate if not s.get("translated_text", "").startswith("[")],
            target_language=request.target_language,
        )
        logger.info(f"TM auto-populated: {stored} entries added.")
    except Exception as e:
        logger.warning(f"TM auto-populate failed (non-critical): {e}")

    logger.info(
        f"Translation done: {translated_count} translated, "
        f"{len(all_segments) - len(to_translate)} skipped."
    )

    return TranslateResponse(
        document_id=request.document_id,
        segments_translated=translated_count,
        segments=[Segment(**s) for s in data["segments"]],
    )