"""
Translation router.
"""

import json
import logging
from datetime import datetime
from typing import Dict, List, Tuple

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.domain import Document, Segment as SegmentDB
from app.models.schemas import Segment, TranslateRequest, TranslateResponse
from app.services.collaboration import (
    attach_collaboration_fields,
    enrich_collaborator,
    get_assignment_map,
    get_current_backend_collaborator,
    require_document_role,
    require_segment_assignment,
)
from app.services.glossary_engine import (
    build_glossary_prompt_fragment,
    enforce_glossary,
    get_style_rules,
)
from app.services.llm_service import BATCH_SIZE, get_backend_info, translate_batch
from app.services.rag_engine import classify_segment, store_translations_batch
from app.services.validator import validate_segments
from app.utils.embeddings import encode_texts
from app.utils.segment_order import sort_segments

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/translate", tags=["translation"])


def _stream_event(event_type: str, **payload) -> str:
    return json.dumps({"type": event_type, **payload}) + "\n"


def _segment_group_key(segment: Dict) -> str:
    source_text = segment.get("text", "").strip()
    if segment.get("force_llm"):
        return f"{source_text}::__force__:{segment.get('id', '')}"
    return source_text


def _serialize_db_segment(segment: SegmentDB) -> Dict:
    return {
        "id": segment.id,
        "document_id": segment.document_id,
        "text": segment.text,
        "translated_text": segment.translated_text,
        "correction": segment.correction,
        "final_text": segment.final_text,
        "status": segment.status,
        "type": segment.type,
        "parent_id": segment.parent_id,
        "block_type": segment.block_type,
        "position": segment.position,
        "format_snapshot": segment.format_snapshot,
        "tm_match_type": segment.tm_match_type,
        "tm_score": segment.tm_score,
        "row": segment.row,
        "col": segment.col,
        "table_index": segment.table_index,
        "row_count": segment.row_count,
        "col_count": segment.col_count,
        "col_widths": segment.col_widths,
        "created_at": segment.created_at.isoformat() if segment.created_at else None,
        "updated_at": segment.updated_at.isoformat() if segment.updated_at else None,
    }


def _persist_segments(
    db_segments_by_id: Dict[str, SegmentDB],
    segments: List[Dict],
) -> None:
    now = datetime.utcnow()
    for segment in segments:
        db_segment = db_segments_by_id.get(segment["id"])
        if not db_segment:
            continue

        db_segment.translated_text = segment.get("translated_text")
        db_segment.correction = segment.get("correction")
        db_segment.final_text = segment.get("final_text")
        db_segment.status = segment.get("status")
        db_segment.tm_match_type = segment.get("tm_match_type")
        db_segment.tm_score = segment.get("tm_score")
        db_segment.updated_at = now


def _prepare_translation_context(
    request: TranslateRequest,
    db: Session,
) -> Tuple[Document, List[SegmentDB], List[Dict], List[Dict], List[Dict], Dict, str, List[str]]:
    doc = db.query(Document).filter(Document.id == request.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{request.document_id}' not found.")

    db_segments = sort_segments(
        db.query(SegmentDB).filter(SegmentDB.document_id == request.document_id).all()
    )
    all_segments = [_serialize_db_segment(segment) for segment in db_segments]
    metadata = doc.metadata_json or {}
    prev_language = metadata.get("target_language", "")
    target_ids = set(request.segment_ids) if request.segment_ids else None
    force_llm_ids = set(request.force_llm_segment_ids or [])
    effective_rules = request.style_rules or get_style_rules()
    classification = doc.metadata_json.get("classification", {}) if doc.metadata_json else {}
    document_domain = classification.get("domain")
    glossary_fragment = build_glossary_prompt_fragment(
        "",
        request.target_language,
        document_domain=document_domain,
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

    to_translate: List[Dict] = []
    pre_updated_segments: List[Dict] = []
    for segment in all_segments:
        if target_ids and segment["id"] not in target_ids:
            continue
        if segment.get("status") == "skip":
            continue
        if segment.get("correction"):
            segment["final_text"] = segment["correction"]
            segment["status"] = "reviewed"
            segment["updated_at"] = datetime.utcnow().isoformat()
            pre_updated_segments.append(segment)
            continue

        language_changed = (
            prev_language
            and prev_language.lower() != request.target_language.lower()
        )
        if language_changed and segment.get("translated_text") and not segment.get("correction"):
            segment["translated_text"] = None
            segment["status"] = "pending"
            segment["tm_match_type"] = None
            segment["tm_score"] = None

        translated_text = segment.get("translated_text", "") or ""
        if target_ids:
            segment["translated_text"] = None
            segment["status"] = "pending"
        elif translated_text and not translated_text.startswith("[") and translated_text.strip() != segment.get("text", "").strip():
            continue

        if not segment.get("text", "").strip():
            continue

        segment["force_llm"] = segment["id"] in force_llm_ids
        segment["glossary_fragment"] = glossary_fragment
        to_translate.append(segment)

    return (
        doc,
        db_segments,
        all_segments,
        pre_updated_segments,
        to_translate,
        classification,
        document_domain or "",
        effective_rules,
    )


def _classify_translation_memory(
    segments: List[Dict],
    target_language: str,
) -> List[Dict]:
    unique_groups: Dict[str, List[Dict]] = {}
    for segment in segments:
        group_key = _segment_group_key(segment)
        unique_groups.setdefault(group_key, []).append(segment)

    unique_segments = [group[0] for group in unique_groups.values() if group]
    if not unique_segments:
        return []

    embeddable_segments = [segment for segment in unique_segments if not segment.get("force_llm")]
    embeddings_by_id: Dict[str, object] = {}
    if embeddable_segments:
        try:
            sources = [segment["text"].strip() for segment in embeddable_segments]
            embeddings = encode_texts(sources)
            embeddings_by_id = {
                segment["id"]: embedding
                for segment, embedding in zip(embeddable_segments, embeddings)
            }
        except Exception as exc:
            logger.error(f"Batch embedding failed: {exc}")

    for segment in unique_segments:
        group_key = _segment_group_key(segment)
        if segment.get("force_llm"):
            match_type, tm_translation, score = "new", None, 0.0
        elif segment.get("id") in embeddings_by_id:
            try:
                embedding = embeddings_by_id[segment["id"]]
                match_type, tm_translation, score = classify_segment(
                    segment["text"],
                    embedding,
                    target_language=target_language,
                )
            except Exception as exc:
                logger.warning(f"TM classify failed for {segment['id']}: {exc}")
                match_type, tm_translation, score = "new", None, 0.0
        else:
            match_type, tm_translation, score = "new", None, 0.0

        for grouped_segment in unique_groups.get(group_key, []):
            grouped_segment["tm_match_type"] = match_type
            grouped_segment["tm_score"] = round(score, 4)
            grouped_segment["tm_translation"] = tm_translation

    return unique_segments


def _finalize_translated_segments(
    unique_batch: List[Dict],
    unique_groups: Dict[str, List[Dict]],
    all_segments_by_id: Dict[str, Dict],
    target_language: str,
    document_domain: str,
) -> Tuple[List[Dict], int]:
    updated_segments: List[Dict] = []
    translated_count = 0

    for unique_segment in unique_batch:
        group_key = _segment_group_key(unique_segment)
        grouped_segments = unique_groups.get(group_key, [])
        raw_translation = unique_segment.get("translated_text", "")

        for segment in grouped_segments:
            updated_segment = all_segments_by_id[segment["id"]]
            updated_segment["tm_match_type"] = unique_segment.get("tm_match_type")
            updated_segment["tm_score"] = unique_segment.get("tm_score")

            if not raw_translation or raw_translation.startswith("[ERROR"):
                updated_segment["translated_text"] = raw_translation
                updated_segments.append(updated_segment)
                continue

            corrected, _violations = enforce_glossary(
                raw_translation,
                segment["text"],
                target_language,
                document_domain=document_domain or None,
            )
            updated_segment["translated_text"] = corrected
            updated_segment["status"] = "reviewed"
            updated_segment["updated_at"] = datetime.utcnow().isoformat()
            translated_count += 1
            updated_segments.append(updated_segment)

    return updated_segments, translated_count


def _finalize_tm_segments(
    unique_segments: List[Dict],
    to_translate: List[Dict],
    all_segments: List[Dict],
) -> Tuple[List[Dict], List[Dict], int]:
    unique_groups: Dict[str, List[Dict]] = {}
    for segment in to_translate:
        unique_groups.setdefault(_segment_group_key(segment), []).append(segment)

    all_segments_by_id = {segment["id"]: segment for segment in all_segments}
    tm_unique_segments: List[Dict] = []
    remaining_unique_segments: List[Dict] = []
    updated_segments: List[Dict] = []
    translated_count = 0

    for unique_segment in unique_segments:
        if unique_segment.get("tm_match_type") in {"exact", "fuzzy"} and unique_segment.get("tm_translation"):
            tm_unique_segments.append(unique_segment)
        else:
            remaining_unique_segments.append(unique_segment)

    for unique_segment in tm_unique_segments:
        group_key = _segment_group_key(unique_segment)
        grouped_segments = unique_groups.get(group_key, [])
        tm_translation = unique_segment.get("tm_translation", "")

        for segment in grouped_segments:
            updated_segment = all_segments_by_id[segment["id"]]
            updated_segment["translated_text"] = tm_translation
            updated_segment["status"] = "reviewed"
            updated_segment["updated_at"] = datetime.utcnow().isoformat()
            updated_segment["tm_match_type"] = unique_segment.get("tm_match_type")
            updated_segment["tm_score"] = unique_segment.get("tm_score")
            updated_segments.append(updated_segment)
            translated_count += 1

    return updated_segments, remaining_unique_segments, translated_count


def _run_translation_batches(
    to_translate: List[Dict],
    all_segments: List[Dict],
    target_language: str,
    document_domain: str,
    effective_rules: List[str],
):
    unique_groups: Dict[str, List[Dict]] = {}
    for segment in to_translate:
        unique_groups.setdefault(_segment_group_key(segment), []).append(segment)

    unique_segments = _classify_translation_memory(to_translate, target_language)
    all_segments_by_id = {segment["id"]: segment for segment in all_segments}
    tm_segments, remaining_unique_segments, tm_translated_count = _finalize_tm_segments(
        unique_segments=unique_segments,
        to_translate=to_translate,
        all_segments=all_segments,
    )

    if tm_segments:
        yield {
            "kind": "tm_match",
            "batch_index": 0,
            "total_batches": 0,
            "updated_segments": tm_segments,
            "translated_count": tm_translated_count,
        }

    total_batches = (
        (len(remaining_unique_segments) + BATCH_SIZE - 1) // BATCH_SIZE
        if remaining_unique_segments
        else 0
    )

    for batch_index in range(total_batches):
        unique_batch = remaining_unique_segments[batch_index * BATCH_SIZE:(batch_index + 1) * BATCH_SIZE]
        translate_batch(
            segments=unique_batch,
            target_language=target_language,
            style_rules=effective_rules,
        )
        updated_segments, translated_count = _finalize_translated_segments(
            unique_batch=unique_batch,
            unique_groups=unique_groups,
            all_segments_by_id=all_segments_by_id,
            target_language=target_language,
            document_domain=document_domain,
        )
        yield {
            "kind": "llm_batch",
            "batch_index": batch_index + 1,
            "total_batches": total_batches,
            "updated_segments": updated_segments,
            "translated_count": translated_count,
        }


def _store_tm_from_segments(segments: List[Dict], target_language: str) -> None:
    try:
        added = store_translations_batch(segments=segments, target_language=target_language)
        logger.info(f"TM auto-store completed: {added} entries added for language {target_language}.")
    except Exception as exc:
        logger.warning(f"TM auto-store failed: {exc}")


@router.get("/info")
async def translation_info():
    return get_backend_info()


@router.post("", response_model=TranslateResponse)
async def translate_document(
    request: TranslateRequest,
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    collaborator = enrich_collaborator(db, collaborator)
    membership = require_document_role(db, request.document_id, collaborator, ["owner", "editor"])
    if request.segment_ids:
        require_segment_assignment(db, request.document_id, request.segment_ids, collaborator, membership)

    (
        doc,
        db_segments,
        all_segments,
        pre_updated_segments,
        to_translate,
        _classification,
        document_domain,
        effective_rules,
    ) = _prepare_translation_context(request, db)

    metadata = doc.metadata_json or {}
    metadata["target_language"] = request.target_language
    doc.metadata_json = metadata

    db_segments_by_id = {segment.id: segment for segment in db_segments}
    if pre_updated_segments:
        _persist_segments(db_segments_by_id, pre_updated_segments)

    translated_count = 0
    for batch_result in _run_translation_batches(
        to_translate=to_translate,
        all_segments=all_segments,
        target_language=request.target_language,
        document_domain=document_domain,
        effective_rules=effective_rules,
    ):
        translated_count += batch_result["translated_count"]
        _persist_segments(db_segments_by_id, batch_result["updated_segments"])

    db.commit()
    _store_tm_from_segments(all_segments, request.target_language)

    logger.info(
        f"Translation complete: {translated_count} segments translated. TM will be updated on approval."
    )

    assignments = get_assignment_map(db, request.document_id)

    return TranslateResponse(
        document_id=request.document_id,
        segments_translated=translated_count,
        segments=[
            Segment(**attach_collaboration_fields(segment, assignments.get(segment["id"])))
            for segment in all_segments
        ],
    )


@router.post("/stream")
async def translate_document_stream(
    request: TranslateRequest,
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    collaborator = enrich_collaborator(db, collaborator)
    membership = require_document_role(db, request.document_id, collaborator, ["owner", "editor"])
    if request.segment_ids:
        require_segment_assignment(db, request.document_id, request.segment_ids, collaborator, membership)

    (
        doc,
        db_segments,
        all_segments,
        pre_updated_segments,
        to_translate,
        _classification,
        document_domain,
        effective_rules,
    ) = _prepare_translation_context(request, db)

    metadata = doc.metadata_json or {}
    metadata["target_language"] = request.target_language
    doc.metadata_json = metadata

    db_segments_by_id = {segment.id: segment for segment in db_segments}
    all_segment_indexes = {segment["id"]: index for index, segment in enumerate(all_segments)}
    total_segments = len(to_translate)
    assignments = get_assignment_map(db, request.document_id)

    def generate():
        yield _stream_event(
            "start",
            document_id=request.document_id,
            target_language=request.target_language,
            total_segments=total_segments,
        )

        if pre_updated_segments:
            _persist_segments(db_segments_by_id, pre_updated_segments)
            db.commit()

        completed = 0
        translated_count = 0

        for batch_result in _run_translation_batches(
            to_translate=to_translate,
            all_segments=all_segments,
            target_language=request.target_language,
            document_domain=document_domain,
            effective_rules=effective_rules,
        ):
            updated_segments = batch_result["updated_segments"]
            _persist_segments(db_segments_by_id, updated_segments)
            db.commit()

            translated_count += batch_result["translated_count"]
            completed += len(updated_segments)

            for updated_segment in sort_segments(updated_segments):
                payload = attach_collaboration_fields(
                    updated_segment,
                    assignments.get(updated_segment["id"]),
                )
                yield _stream_event(
                    "segment",
                    document_id=request.document_id,
                    segment_id=updated_segment["id"],
                    index=all_segment_indexes.get(updated_segment["id"], completed - 1),
                    batch=batch_result["batch_index"],
                    total_batches=batch_result["total_batches"],
                    segment=payload,
                )

            yield _stream_event(
                "progress",
                document_id=request.document_id,
                completed=completed,
                total=total_segments,
                translated=translated_count,
            )

        if not to_translate:
            db.commit()

        _store_tm_from_segments(all_segments, request.target_language)

        yield _stream_event(
            "complete",
            document_id=request.document_id,
            completed=completed,
            total=total_segments,
            translated=translated_count,
        )

    return StreamingResponse(generate(), media_type="application/x-ndjson")
