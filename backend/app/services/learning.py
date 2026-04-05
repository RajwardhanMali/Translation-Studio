"""
Continuous learning service.
On segment approval:
  1. Update Postgres pgvector TM with the corrected translation
  2. Append a training example to the JSONL fine-tune dataset
  3. Persist training feedback rows in Postgres for dataset curation
"""

import logging
from threading import Lock
from typing import Dict
from uuid import uuid4

from sqlalchemy import text

from app.database import SessionLocal
from app.utils.embeddings import encode_single
from app.utils.file_handler import append_fine_tune_example
from app.services.rag_engine import store_translation

logger = logging.getLogger(__name__)


_FINE_TUNE_TABLE_READY = False
_FINE_TUNE_TABLE_LOCK = Lock()


def _ensure_fine_tune_feedback_table() -> None:
    global _FINE_TUNE_TABLE_READY
    if _FINE_TUNE_TABLE_READY:
        return

    with _FINE_TUNE_TABLE_LOCK:
        if _FINE_TUNE_TABLE_READY:
            return

        db = SessionLocal()
        try:
            db.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS fine_tune_feedback (
                      id text PRIMARY KEY,
                      segment_id text,
                      document_id text,
                      language text NOT NULL,
                      source_text text NOT NULL,
                      output_text text NOT NULL,
                      is_human_edited boolean NOT NULL DEFAULT false,
                      created_at timestamptz NOT NULL DEFAULT now()
                    )
                    """
                )
            )
            db.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS fine_tune_feedback_language_created_idx
                    ON fine_tune_feedback (language, created_at DESC)
                    """
                )
            )
            db.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS fine_tune_feedback_segment_idx
                    ON fine_tune_feedback (segment_id)
                    """
                )
            )
            db.commit()
            _FINE_TUNE_TABLE_READY = True
        finally:
            db.close()


def _store_feedback_example_db(
    source_text: str,
    output_text: str,
    target_language: str,
    segment: Dict,
) -> None:
    _ensure_fine_tune_feedback_table()

    translated_text = (segment.get("translated_text") or "").strip()
    final_text = output_text.strip()
    is_human_edited = bool(segment.get("correction")) or (
        bool(translated_text) and final_text != translated_text
    )

    db = SessionLocal()
    try:
        db.execute(
            text(
                """
                INSERT INTO fine_tune_feedback (
                  id,
                  segment_id,
                  document_id,
                  language,
                  source_text,
                  output_text,
                  is_human_edited
                ) VALUES (
                  :id,
                  :segment_id,
                  :document_id,
                  :language,
                  :source_text,
                  :output_text,
                  :is_human_edited
                )
                """
            ),
            {
                "id": str(uuid4()),
                "segment_id": segment.get("id"),
                "document_id": segment.get("document_id"),
                "language": target_language,
                "source_text": source_text,
                "output_text": output_text,
                "is_human_edited": is_human_edited,
            },
        )
        db.commit()
    finally:
        db.close()


def on_segment_approved(
    segment: Dict,
    target_language: str,
) -> None:
    """
    Called after a segment is approved.
    """
    source_text = segment.get("text", "")
    final_text  = segment.get("final_text") or segment.get("translated_text")

    if not source_text or not final_text:
        logger.warning(
            f"Skipping learning for segment {segment.get('id')}: "
            "source or final text is empty."
        )
        return

    try:
        embedding = encode_single(source_text)
    except Exception as e:
        logger.error(f"Embedding failed for segment {segment.get('id')}: {e}")
        return

    # 2. Update TM in Postgres
    try:
        # store_translation now handles overwrite internally for same source+lang
        store_translation(
            source_text=source_text,
            target_text=final_text,
            language=target_language,
            embedding=embedding,
            segment_id=segment.get("id"),
            document_id=segment.get("document_id"),
        )
        logger.info(
            f"TM updated for segment {segment.get('id')}: "
            f"'{source_text[:50]}' → '{final_text[:50]}'"
        )
    except Exception as e:
        logger.error(f"TM store failed for segment {segment.get('id')}: {e}")

    # 3. Append fine-tuning example
    try:
        append_fine_tune_example(
            input_text=source_text,
            output_text=final_text,
        )
    except Exception as e:
        logger.error(f"Fine-tune append failed: {e}")

    # 4. Persist to database for searchable/curated training datasets.
    try:
        _store_feedback_example_db(
            source_text=source_text,
            output_text=final_text,
            target_language=target_language,
            segment=segment,
        )
    except Exception as e:
        logger.error(f"Fine-tune feedback DB store failed: {e}")