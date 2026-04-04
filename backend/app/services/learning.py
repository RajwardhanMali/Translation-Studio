"""
Continuous learning service.
On segment approval:
  1. Update Postgres pgvector TM with the corrected translation
  2. Append a training example to the JSONL fine-tune dataset
"""

import logging
from typing import Dict, Optional

from app.utils.embeddings import encode_single
from app.utils.file_handler import append_fine_tune_example
from app.services.rag_engine import store_translation

logger = logging.getLogger(__name__)


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