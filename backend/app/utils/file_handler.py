"""
File handler utility.
Manages paths, JSON persistence, and file I/O for documents and segments.
"""

import json
import os
import logging
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Base data directory (relative to this file's location)
BASE_DIR = Path(__file__).resolve().parent.parent / "data"

UPLOADS_DIR      = BASE_DIR / "uploads"
PARSED_DIR       = BASE_DIR / "parsed_docs"
SEGMENTED_DIR    = BASE_DIR / "segmented_docs"
FAISS_DIR        = BASE_DIR / "faiss_index"
DATASETS_DIR     = BASE_DIR / "datasets"
GLOSSARY_PATH    = BASE_DIR / "glossary.json"
FINE_TUNE_PATH   = DATASETS_DIR / "fine_tune.jsonl"
EXPORTS_DIR = BASE_DIR / "exported_docs"
EXPORTS_DIR.mkdir(parents=True, exist_ok=True)

# Ensure all directories exist at import time
for _dir in [UPLOADS_DIR, PARSED_DIR, SEGMENTED_DIR, FAISS_DIR, DATASETS_DIR]:
    _dir.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Generic JSON helpers
# ---------------------------------------------------------------------------

def save_json(path: Path, data: Any) -> None:
    """Atomically write JSON to disk."""
    tmp = path.with_suffix(".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(path)
        logger.debug(f"Saved JSON → {path}")
    except Exception as e:
        logger.error(f"Failed to save JSON to {path}: {e}")
        if tmp.exists():
            tmp.unlink()
        raise


def load_json(path: Path) -> Optional[Any]:
    """Load JSON from disk, returning None if file doesn't exist."""
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load JSON from {path}: {e}")
        return None


# ---------------------------------------------------------------------------
# Document-specific helpers
# ---------------------------------------------------------------------------

def get_parsed_path(document_id: str) -> Path:
    return PARSED_DIR / f"{document_id}.json"


def get_segmented_path(document_id: str) -> Path:
    return SEGMENTED_DIR / f"{document_id}.json"


def save_parsed_document(document_id: str, data: Dict) -> None:
    save_json(get_parsed_path(document_id), data)


def load_parsed_document(document_id: str) -> Optional[Dict]:
    return load_json(get_parsed_path(document_id))


def save_segmented_document(document_id: str, data: Dict) -> None:
    save_json(get_segmented_path(document_id), data)


def load_segmented_document(document_id: str) -> Optional[Dict]:
    return load_json(get_segmented_path(document_id))


def update_segment_in_store(document_id: str, segment_id: str, updates: Dict) -> bool:
    """
    Load segmented document, apply updates to a specific segment, and save.
    Returns True on success, False if segment not found.
    """
    data = load_segmented_document(document_id)
    if data is None:
        logger.warning(f"Segmented document not found: {document_id}")
        return False

    for seg in data.get("segments", []):
        if seg["id"] == segment_id:
            seg.update(updates)
            save_segmented_document(document_id, data)
            return True

    logger.warning(f"Segment {segment_id} not found in document {document_id}")
    return False


# ---------------------------------------------------------------------------
# JSONL fine-tuning dataset
# ---------------------------------------------------------------------------

def append_fine_tune_example(input_text: str, output_text: str) -> None:
    """Append a training example to the JSONL fine-tuning file."""
    entry = {"input": input_text, "output": output_text}
    try:
        with open(FINE_TUNE_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        logger.debug(f"Appended fine-tune example: {input_text[:60]}…")
    except Exception as e:
        logger.error(f"Failed to append fine-tune example: {e}")


# ---------------------------------------------------------------------------
# Glossary helpers
# ---------------------------------------------------------------------------

def load_glossary() -> Dict:
    data = load_json(GLOSSARY_PATH)
    return data if data else {"terms": [], "style_rules": []}


def save_glossary(data: Dict) -> None:
    save_json(GLOSSARY_PATH, data)


# ---------------------------------------------------------------------------
# Upload file path
# ---------------------------------------------------------------------------

def get_upload_path(filename: str) -> Path:
    return UPLOADS_DIR / filename


# ---------------------------------------------------------------------------
# Document listing — for the documents dashboard
# ---------------------------------------------------------------------------

def list_all_documents() -> list:
    """
    Scan parsed_docs/ and segmented_docs/ to build a summary list of every
    document that has been uploaded, including translation progress stats.
    """
    docs = []
    for parsed_path in sorted(
        PARSED_DIR.glob("*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    ):
        parsed = load_json(parsed_path)
        if not parsed:
            continue

        doc_id   = parsed.get("id", parsed_path.stem)
        seg_data = load_json(get_segmented_path(doc_id))

        total = pending = reviewed = approved = 0
        if seg_data:
            segments = seg_data.get("segments", [])
            total    = len(segments)
            pending  = sum(1 for s in segments if s.get("status") == "pending")
            reviewed = sum(1 for s in segments if s.get("status") == "reviewed")
            approved = sum(1 for s in segments if s.get("status") == "approved")

        docs.append({
            "id":          doc_id,
            "filename":    parsed.get("filename", "unknown"),
            "file_type":   parsed.get("file_type", "unknown"),
            "created_at":  parsed.get("created_at"),
            "blocks_count": len(parsed.get("blocks", [])),
            "segments": {
                "total":    total,
                "pending":  pending,
                "reviewed": reviewed,
                "approved": approved,
            },
            "translation_progress": (
                round((reviewed + approved) / total * 100, 1) if total else 0.0
            ),
        })
    return docs


