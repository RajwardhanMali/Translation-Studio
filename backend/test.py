import json
import logging
import os
import sys
import time
import difflib
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# Ensure backend package imports resolve when running from backend/test.py
ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))

from app.services.parser import parse_document
from app.services.segmenter import segment_blocks
from app.services.validator import validate_segments, apply_ai_fixes
from app.services.llm_service import _translate_batch_llm, BATCH_SIZE
from app.utils.embeddings import encode_texts

try:
    import faiss
except ImportError as e:
    raise ImportError(
        "FAISS is required by backend/test.py. Install it with `pip install faiss-cpu` "
        "or `pip install faiss` depending on your environment."
    )

try:
    import pymupdf as fitz
    sys.modules["fitz"] = fitz
except ImportError:
    try:
        import fitz
    except ImportError:
        raise ImportError(
            "PyMuPDF is required by backend/test.py. Install it with `pip install PyMuPDF`."
        )
    else:
        raise ImportError(
            "A conflicting 'fitz' package is installed in the environment. "
            "Uninstall it with `pip uninstall fitz` and keep PyMuPDF installed."
        )

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

DATA_DIR = ROOT_DIR / "data"
VALIDATION_DIR = DATA_DIR / "validation"
TRANSLATION_MEMORY_PATH = DATA_DIR / "translation_memory.json"
EVALUATION_METRICS_PATH = DATA_DIR / "evaluation_metrics.json"
SOURCE_FILES = [f"sec{i}.pdf" for i in range(10)]
VALIDATION_FILES = [f"sec{i}.pdf" for i in range(5)]
TARGET_LANGUAGE = "Spanish"
TARGET_CODE = "esp"
TM_SIMILARITY_THRESHOLD = 0.85
DELAY = float(os.getenv("TEST_DELAY", "5.0"))


def load_documents() -> List[Dict[str, Any]]:
    documents = []
    for filename in SOURCE_FILES:
        doc_id = Path(filename).stem
        doc_path = DATA_DIR / filename
        validation_path = VALIDATION_DIR / filename if filename in VALIDATION_FILES else None
        if not doc_path.exists():
            raise FileNotFoundError(f"Missing source document: {doc_path}")
        if validation_path and not validation_path.exists():
            raise FileNotFoundError(f"Missing validation document: {validation_path}")
        documents.append({
            "id": doc_id,
            "path": doc_path,
            "validation_path": validation_path,
        })
    return documents


def upload_document(filepath: Path) -> List[Dict[str, Any]]:
    logger.info(f"Uploading document: {filepath.name}")
    blocks = extract_blocks_from_pdf(filepath)
    logger.info(f"Extracted {len(blocks)} blocks from {filepath.name}")
    return blocks


def extract_blocks_from_pdf(filepath: Path) -> List[Dict[str, Any]]:
    return parse_document(filepath, filepath.stem, file_type="pdf")


def segment_text(blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    logger.info("Segmenting document into translation units")
    segments = segment_blocks(blocks)
    segments = sorted(
        segments,
        key=lambda s: (
            s.get("position", {}).get("block_index", 0),
            s.get("position", {}).get("sentence_index") or 0,
            s.get("position", {}).get("phrase_index") or 0,
        ),
    )
    logger.info(f"Created {len(segments)} segments")
    return segments


def validate_segments_pipeline(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not segments:
        return segments

    logger.info("Validating segments with deterministic and AI checks")
    validation_results = validate_segments(
        segments,
        auto_fix=False,
        only_with_issues=False,
        enable_ai=True,
        min_issue_severity="info",
    )
    fixed = apply_ai_fixes(segments)
    logger.info(
        "Validation complete: %d segments with results, %d applied fixes",
        len(validation_results),
        fixed.get("fixed_count", 0),
    )
    return segments


def _load_translation_memory() -> Dict[str, Any]:
    if TRANSLATION_MEMORY_PATH.exists():
        with TRANSLATION_MEMORY_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        data = {"entries": []}
    if "entries" not in data or not isinstance(data["entries"], list):
        data = {"entries": []}
    return data


def _save_translation_memory(memory: Dict[str, Any]) -> None:
    with TRANSLATION_MEMORY_PATH.open("w", encoding="utf-8") as fh:
        json.dump(memory, fh, ensure_ascii=False, indent=2)


def _normalize_source_text(text: str) -> str:
    return " ".join(text.strip().split()).lower()


def build_faiss_index(memory: Dict[str, Any]) -> Tuple[Optional[faiss.IndexFlatIP], List[Dict[str, Any]]]:
    entries = memory.get("entries", [])
    if not entries:
        return None, entries

    embeddings = []
    for entry in entries:
        emb = entry.get("embedding")
        if not emb:
            continue
        embeddings.append(emb)

    if not embeddings:
        return None, entries

    matrix = np.array(embeddings, dtype="float32")
    if matrix.ndim != 2:
        raise ValueError("Translation memory embeddings must be 2D")
    if matrix.shape[1] == 0:
        return None, entries

    faiss.normalize_L2(matrix)
    index = faiss.IndexFlatIP(matrix.shape[1])
    index.add(matrix)
    return index, entries


def check_translation_memory(
    source_text: str,
    memory: Dict[str, Any],
    index: Optional[faiss.IndexFlatIP],
    entries: List[Dict[str, Any]],
) -> Optional[Tuple[str, float]]:
    normalized = _normalize_source_text(source_text)
    if not normalized:
        return None

    for entry in memory.get("entries", []):
        if _normalize_source_text(entry.get("source_text", "")) == normalized:
            return entry.get("target_text", ""), 1.0

    if index is None or not entries:
        return None

    return query_faiss(source_text, index, entries)


def query_faiss(
    source_text: str,
    index: faiss.IndexFlatIP,
    entries: List[Dict[str, Any]],
    top_k: int = 1,
    threshold: float = TM_SIMILARITY_THRESHOLD,
) -> Optional[Tuple[str, float]]:
    if not source_text.strip():
        return None

    embedding = encode_texts(source_text)
    faiss.normalize_L2(embedding)
    distances, indices = index.search(embedding, top_k)
    if distances.shape[0] == 0 or indices.shape[0] == 0:
        return None

    best_score = float(distances[0, 0])
    best_index = int(indices[0, 0])
    if best_index < 0 or best_index >= len(entries):
        return None

    if best_score < threshold:
        return None

    return entries[best_index].get("target_text", ""), best_score


def translate_segments(
    segments: List[Dict[str, Any]],
    memory: Dict[str, Any],
    index: Optional[faiss.IndexFlatIP],
    entries: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], float]:
    logger.info("Applying translation memory and batching segments for translation")
    delay_time = 0.0

    pending_segments: List[Dict[str, Any]] = []
    unique_texts: Dict[str, List[Dict[str, Any]]] = {}

    for seg in segments:
        if seg.get("status") == "skip" or not seg.get("text", "").strip():
            continue
        source = seg["text"].strip()
        tm_match = check_translation_memory(source, memory, index, entries)
        if tm_match:
            translated, score = tm_match
            seg["translated_text"] = translated
            seg["tm_match_type"] = "exact"
            seg["tm_score"] = round(score, 4)
            seg["tm_translation"] = translated
            logger.debug(f"TM reuse ({score:.3f}): {source[:40]}")
            continue

        normalized = _normalize_source_text(source)
        unique_texts.setdefault(normalized, []).append(seg)
        if len(unique_texts[normalized]) == 1:
            pending_segments.append(seg)

    if not pending_segments:
        logger.info("No LLM calls needed; all segments resolved from TM")
        return segments, delay_time

    unique_sources = [seg["text"].strip() for seg in pending_segments]
    total_batches = (len(unique_sources) + BATCH_SIZE - 1) // BATCH_SIZE

    for batch_idx in range(total_batches):
        batch_texts = unique_sources[batch_idx * BATCH_SIZE : (batch_idx + 1) * BATCH_SIZE]
        logger.info(
            "Translating batch %d/%d (%d segments)",
            batch_idx + 1,
            total_batches,
            len(batch_texts),
        )

        translations = _translate_batch_llm(
            texts=batch_texts,
            target_language=TARGET_LANGUAGE,
        )

        for source_text, translated in zip(batch_texts, translations):
            normalized = _normalize_source_text(source_text)
            best_segments = unique_texts.get(normalized, [])
            output = translated.strip() if translated and translated.strip() else "[ERROR: empty translation returned]"
            for seg in best_segments:
                seg["translated_text"] = output
                seg["tm_match_type"] = "new"
                seg["tm_score"] = 0.0

        if batch_idx < total_batches - 1:
            logger.info("Sleeping %ss between batch calls to respect rate limits", DELAY)
            time.sleep(DELAY)
            delay_time += DELAY

    return segments, delay_time


def update_translation_memory(
    segments: List[Dict[str, Any]],
    memory: Dict[str, Any],
    index: Optional[faiss.IndexFlatIP],
    entries: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], Optional[faiss.IndexFlatIP], List[Dict[str, Any]]]:
    new_entries = []
    existing_sources = {
        _normalize_source_text(entry.get("source_text", ""))
        for entry in memory.get("entries", [])
    }

    for seg in segments:
        if seg.get("status") == "skip":
            continue
        source = seg.get("text", "").strip()
        translated = seg.get("translated_text", "").strip()
        if not source or not translated or translated.startswith("[ERROR"):
            continue

        normalized = _normalize_source_text(source)
        if normalized in existing_sources:
            continue

        embedding = encode_texts(source).tolist()[0]
        existing_sources.add(normalized)
        new_entry = {
            "source_text": source,
            "target_text": translated,
            "embedding": embedding,
        }
        memory["entries"].append(new_entry)
        new_entries.append(new_entry)

    if new_entries:
        logger.info("Adding %d new TM entries", len(new_entries))
        if index is None:
            index = faiss.IndexFlatIP(len(new_entries[0]["embedding"]))
        vectors = np.array([entry["embedding"] for entry in new_entries], dtype="float32")
        faiss.normalize_L2(vectors)
        index.add(vectors)
        entries.extend(new_entries)

    return memory, index, entries


def compute_accuracy(generated_text: str, validation_text: str) -> float:
    matcher = difflib.SequenceMatcher(a=generated_text, b=validation_text)
    return round(matcher.ratio(), 4)


def compute_metrics(
    doc_id: str,
    page_count: int,
    processing_time: float,
    delay_time: float,
) -> Dict[str, Any]:
    actual_time = max(0.0, processing_time - delay_time)
    avg_time = actual_time / page_count if page_count else actual_time
    return {
        "id": doc_id,
        "number_of_pages": page_count,
        "avg_time_per_page": round(avg_time, 4),
        "total_time": round(actual_time, 4),
        "delay_time": round(delay_time, 4),
    }


def reconstruct_document(segments: List[Dict[str, Any]]) -> str:
    parts = []
    for seg in segments:
        text = seg.get("translated_text") if seg.get("translated_text") is not None else seg.get("text", "")
        if text is None:
            text = ""
        parts.append(text.strip())
    filtered = [p for p in parts if p]
    return "\n".join(filtered)


def extract_validation_text(validation_path: Path) -> str:
    doc = fitz.open(str(validation_path))
    pages = [page.get_text("text") for page in doc]
    doc.close()
    return "\n".join(pages).strip()


def get_page_count(filepath: Path) -> int:
    doc = fitz.open(str(filepath))
    count = len(doc)
    doc.close()
    return count


def main() -> None:
    documents = load_documents()
    memory = _load_translation_memory()
    index, entries = build_faiss_index(memory)
    metrics: List[Dict[str, Any]] = []
    accuracy_results: List[Dict[str, Any]] = []

    for document in documents:
        doc_id = document["id"]
        logger.info("\n=== Processing %s ===", doc_id)

        start_time = time.perf_counter()
        delay_time = 0.0

        blocks = upload_document(document["path"])
        segments = segment_text(blocks)
        segments = validate_segments_pipeline(segments)

        segments, delay_secs = translate_segments(segments, memory, index, entries)
        delay_time += delay_secs

        memory, index, entries = update_translation_memory(segments, memory, index, entries)
        _save_translation_memory(memory)

        reconstructed = reconstruct_document(segments)
        total_time = time.perf_counter() - start_time
        pages = get_page_count(document["path"])
        metric = compute_metrics(doc_id, pages, total_time, delay_time)
        metrics.append(metric)

        if document["validation_path"]:
            validation_text = extract_validation_text(document["validation_path"])
            accuracy = compute_accuracy(reconstructed, validation_text)
            accuracy_results.append({"id": doc_id, "accuracy": accuracy})
            logger.info("Accuracy for %s: %s", doc_id, accuracy)
        else:
            logger.info("No validation available for %s; skipping accuracy.", doc_id)

    with EVALUATION_METRICS_PATH.open("w", encoding="utf-8") as fh:
        json.dump(metrics, fh, ensure_ascii=False, indent=2)

    if accuracy_results:
        accuracy_path = DATA_DIR / "accuracy_results.json"
        with accuracy_path.open("w", encoding="utf-8") as fh:
            json.dump(accuracy_results, fh, ensure_ascii=False, indent=2)
        logger.info("Wrote accuracy results to %s", accuracy_path)

    logger.info("Wrote evaluation metrics to %s", EVALUATION_METRICS_PATH)
    logger.info("Pipeline complete.")


if __name__ == "__main__":
    main()
