"""
RAG + Translation Memory engine — language-aware (v4).

Architecture change:
Replaced FAISS multi-index TM in-memory cache with PostgreSQL pgvector.
"""

import logging
from typing import Optional, Tuple, List, Dict, Any

import numpy as np
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.domain import TranslationMemory

logger = logging.getLogger(__name__)

EXACT_THRESHOLD = 0.95
FUZZY_THRESHOLD = 0.75
SEARCH_TOP_K    = 5

# ── Public API ────────────────────────────────────────────────────────────────

def classify_segment(
    source_text: str,
    embedding: np.ndarray,
    target_language: str,          
) -> Tuple[str, Optional[str], float]:
    """
    Classify a segment against the TM for a specific target language using pgvector.
    Returns:
        (match_type, tm_translation | None, score)
    """
    db: Session = SessionLocal()
    try:
        lang = target_language.lower()
        normalized_source = source_text.strip().lower()

        exact_stmt = (
            select(TranslationMemory)
            .where(TranslationMemory.language == lang)
            .where(func.lower(func.trim(TranslationMemory.source_text)) == normalized_source)
            .limit(1)
        )
        exact_entry = db.execute(exact_stmt).scalar_one_or_none()
        if exact_entry:
            logger.info(
                f"TM exact [text match] [{target_language}]: '{source_text[:50]}'"
            )
            return "exact", exact_entry.target_text, 1.0

        vec_list = embedding.tolist()
        
        # pgvector cosine distance: <-> returns distance (0.0 means identical, 2.0 means opposite).
        # Cosine similarity = 1 - (cosine_distance)
        # So we want to order by cosine_distance ascending.
        distance = TranslationMemory.embedding.cosine_distance(vec_list)
        
        stmt = (
            select(TranslationMemory, distance.label("distance"))
            .where(TranslationMemory.language == lang)
            .order_by(distance)
            .limit(1)
        )
        
        result = db.execute(stmt).first()
        if not result:
            return "new", None, 0.0
            
        tm_entry, dist = result
        score = 1.0 - float(dist)

        if score < FUZZY_THRESHOLD:
            return "new", None, score

        tm_translation = tm_entry.target_text

        if score >= EXACT_THRESHOLD:
            logger.info(
                f"TM exact ({score:.3f}) [{target_language}]: '{source_text[:50]}'"
            )
            return "exact", tm_translation, score

        logger.info(
            f"TM fuzzy ({score:.3f}) [{target_language}]: '{source_text[:50]}'"
        )
        return "fuzzy", tm_translation, score
    finally:
        db.close()


def store_translation(
    source_text: str,
    target_text: str,
    language: str,
    embedding: np.ndarray,
    segment_id: Optional[str] = None,
    document_id: Optional[str] = None,
) -> None:
    """Store a single approved (human-corrected) translation."""
    db: Session = SessionLocal()
    try:
        lang = language.lower()
        src_lower = source_text.strip().lower()

        # Check if identical source exists
        stmt = select(TranslationMemory).where(
            TranslationMemory.language == lang
        )
        existing_entries = db.execute(stmt).scalars().all()
        
        for entry in existing_entries:
            if entry.source_text.strip().lower() == src_lower:
                # Update existing (human correction overwrites)
                entry.target_text = target_text
                entry.document_id = document_id
                entry.embedding = embedding.tolist()
                db.commit()
                logger.debug(f"TM updated existing entry [{lang}]: '{source_text[:50]}'")
                return
        
        # New entry
        new_entry = TranslationMemory(
            language=lang,
            source_text=source_text,
            target_text=target_text,
            embedding=embedding.tolist(),
            document_id=document_id
        )
        db.add(new_entry)
        db.commit()
        logger.debug(f"TM added [{lang}]: '{source_text[:50]}'")
    finally:
        db.close()


def store_translations_batch(
    segments: List[Dict],
    target_language: str,
) -> int:
    """
    Auto-populate TM after translation (no human approval needed).
    Skips entries that already exist for this language.
    """
    from app.utils.embeddings import encode_texts
    
    db: Session = SessionLocal()
    try:
        eligible = [
            s for s in segments
            if s.get("text", "").strip()
            and s.get("translated_text", "").strip()
            and not s.get("translated_text", "").startswith("[ERROR")
            and not s.get("translated_text", "").startswith("[TRANSLATION")
            and s.get("status") != "skip"
        ]

        if not eligible:
            logger.info("TM batch store: no eligible segments.")
            return 0

        sources = [s["text"].strip() for s in eligible]
        try:
            embeddings = encode_texts(sources)
        except Exception as e:
            logger.error(f"Batch embedding failed: {e}")
            return 0

        lang = target_language.lower()
        stmt = select(TranslationMemory).where(TranslationMemory.language == lang)
        existing_entries = db.execute(stmt).scalars().all()
        existing_texts = {e.source_text.strip().lower() for e in existing_entries}

        added_count = 0
        for seg, emb in zip(eligible, embeddings):
            src = seg["text"].strip()
            src_lower = src.lower()
            
            if src_lower not in existing_texts:
                new_entry = TranslationMemory(
                    language=lang,
                    source_text=src,
                    target_text=seg["translated_text"].strip(),
                    document_id=seg.get("document_id"),
                    embedding=emb.tolist()
                )
                db.add(new_entry)
                existing_texts.add(src_lower)
                added_count += 1
                
        if added_count > 0:
            db.commit()
            
        logger.info(f"TM batch: {added_count} new entries added for language {lang}.")
        return added_count
    finally:
        db.close()
