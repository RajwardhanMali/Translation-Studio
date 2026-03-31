"""
Segmentation service — v3 (Format-Preserving).

Key change from v2:
  Segments now carry a `format_snapshot` dict that records everything needed
  to write that segment's text back into the output document in the right
  place, with the right appearance.

  For DOCX segments:
    format_snapshot = {
      "runs":       [{text, formatting}],   # original run breakdown
      "formatting": { paragraph-level props }
    }

  For PDF segments:
    format_snapshot = {
      "lines":      [{spans:[{text,font,size,color,flags,bbox}], bbox}],
      "bbox":       [x0,y0,x1,y1],
      "page":       int,
      "page_width": float,
      "page_height":float,
    }

  Spacer / table_start / table_end / image blocks are stored as
  NON-TRANSLATABLE blocks (no segment created) but are persisted in the
  parsed doc so the regenerator can replay them.

  Table cells: one segment per cell, carries row/col + table_block_id
  so the regenerator knows which table and cell to write to.
"""

import re
import uuid
import hashlib
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

_nlp = None
SPACY_MODEL = "en_core_web_sm"
MIN_SEGMENT_CHARS = 3

# Block types that we do NOT translate — just pass through in reconstruction
SKIP_BLOCK_TYPES = {"spacer", "table_start", "table_end", "image", "header_footer"}


def get_nlp():
    global _nlp
    if _nlp is None:
        try:
            import spacy
            _nlp = spacy.load(SPACY_MODEL)
            logger.info(f"spaCy model loaded: {SPACY_MODEL}")
        except OSError:
            raise RuntimeError(
                f"spaCy model '{SPACY_MODEL}' not found. "
                "Run: python -m spacy download en_core_web_sm"
            )
    return _nlp


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _is_noise(text: str) -> bool:
    t = text.strip()
    if len(t) < MIN_SEGMENT_CHARS:
        return True
    if re.fullmatch(r"[\d\s\.\-\–\—\•\*\/\\|]+", t):
        return True
    if re.fullmatch(r"[\(\[]?[\dA-Za-z]{1,3}[\)\]\.:]?", t):
        return True
    return False


def _extract_format_snapshot(block: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build the format_snapshot dict from a parsed block.
    Captures everything the regenerator needs to reconstruct this block.
    """
    snapshot: Dict[str, Any] = {}

    # DOCX blocks have "runs" and "formatting"
    if "runs" in block:
        snapshot["runs"]       = block.get("runs", [])
        snapshot["formatting"] = block.get("formatting", {})

    # PDF blocks have "lines", "bbox", "page", dimensions
    if "lines" in block:
        snapshot["lines"]        = block.get("lines", [])
        snapshot["bbox"]         = block.get("bbox", [])
        snapshot["page"]         = block.get("page", 0)
        snapshot["page_width"]   = block.get("page_width", 595.0)
        snapshot["page_height"]  = block.get("page_height", 842.0)
        snapshot["body_font_size"] = block.get("body_font_size", 11.0)

    # Table cell extras
    if block.get("block_type") == "table_cell":
        snapshot["table_index"]    = block.get("table_index")
        snapshot["table_block_id"] = block.get("table_block_id")
        snapshot["row"]            = block.get("row")
        snapshot["col"]            = block.get("col")

    # Heading level
    if block.get("level") is not None:
        snapshot["level"] = block["level"]

    return snapshot


def _make_segment(
    document_id: str,
    text: str,
    seg_type: str,
    block_index: int,
    sentence_index: Optional[int],
    parent_id: Optional[str],
    block_type: str,
    format_snapshot: Optional[Dict] = None,
    row: Optional[int] = None,
    col: Optional[int] = None,
) -> Dict[str, Any]:
    return {
        "id":             str(uuid.uuid4()),
        "document_id":    document_id,
        "text":           text.strip(),
        "type":           seg_type,
        "translated_text": None,
        "correction":     None,
        "final_text":     None,
        "status":         "pending",
        "parent_id":      parent_id,
        "block_type":     block_type,
        "position": {
            "block_index":    block_index,
            "sentence_index": sentence_index,
            "phrase_index":   None,
        },
        "format_snapshot": format_snapshot or {},
        "tm_match_type":  None,
        "tm_score":       None,
        "row":            row,
        "col":            col,
    }


def segment_blocks(blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Convert parsed blocks into translation segments, preserving all format metadata.

    Non-translatable blocks (spacers, table markers, images) are stored as
    pass-through segments with status='skip' so the regenerator can replay them.
    """
    nlp = get_nlp()
    segments: List[Dict] = []
    seen_hashes: set = set()

    def _add(seg: Dict) -> bool:
        text = seg["text"].strip()
        # Pass-through / skip segments bypass noise and dedup checks
        if seg.get("status") == "skip":
            segments.append(seg)
            return True
        if _is_noise(text):
            return False
        h = hashlib.md5(_normalise(text).encode()).hexdigest()
        if h in seen_hashes:
            logger.debug(f"Duplicate skipped: '{text[:50]}'")
            return False
        seen_hashes.add(h)
        segments.append(seg)
        return True

    for block in blocks:
        block_type  = block.get("block_type", "paragraph")
        text        = block.get("text", "").strip()
        block_index = block["position"]["block_index"]
        block_id    = block["id"]
        doc_id      = block["document_id"]
        fmt         = _extract_format_snapshot(block)

        # ── Non-translatable pass-through blocks ────────────────────────────
        if block_type in SKIP_BLOCK_TYPES:
            segments.append({
                "id":             str(uuid.uuid4()),
                "document_id":    doc_id,
                "text":           text,
                "type":           block_type,
                "translated_text": None,
                "correction":     None,
                "final_text":     None,
                "status":         "skip",
                "parent_id":      block_id,
                "block_type":     block_type,
                "position":       {"block_index": block_index, "sentence_index": None, "phrase_index": None},
                "format_snapshot": fmt,
                "tm_match_type":  None,
                "tm_score":       None,
                "row":            block.get("row"),
                "col":            block.get("col"),
                # Preserve table structural metadata
                "table_index":    block.get("table_index"),
                "row_count":      block.get("row_count"),
                "col_count":      block.get("col_count"),
                "col_widths":     block.get("col_widths"),
            })
            continue

        # ── Headings ────────────────────────────────────────────────────────
        if block_type == "heading":
            if text:
                _add(_make_segment(
                    document_id=doc_id,
                    text=text,
                    seg_type="heading",
                    block_index=block_index,
                    sentence_index=0,
                    parent_id=block_id,
                    block_type=block_type,
                    format_snapshot=fmt,
                ))
            continue

        # ── Table cells ─────────────────────────────────────────────────────
        if block_type == "table_cell":
            _add(_make_segment(
                document_id=doc_id,
                text=text if text else " ",   # preserve empty cells for structure
                seg_type="table_cell",
                block_index=block_index,
                sentence_index=None,
                parent_id=block_id,
                block_type=block_type,
                format_snapshot=fmt,
                row=block.get("row"),
                col=block.get("col"),
            ))
            continue

        # ── Paragraphs / captions ────────────────────────────────────────────
        if not text or _is_noise(text):
            continue

        # Short blocks — keep whole (avoid mis-splitting "Dr. Smith", "Fig. 2")
        if len(text) < 120:
            _add(_make_segment(
                document_id=doc_id,
                text=text,
                seg_type="sentence",
                block_index=block_index,
                sentence_index=0,
                parent_id=block_id,
                block_type=block_type,
                format_snapshot=fmt,
            ))
            continue

        # Longer blocks → spaCy sentence segmentation
        spacy_doc = nlp(text)
        sentences = list(spacy_doc.sents)

        if len(sentences) == 1:
            _add(_make_segment(
                document_id=doc_id,
                text=text,
                seg_type="sentence",
                block_index=block_index,
                sentence_index=0,
                parent_id=block_id,
                block_type=block_type,
                format_snapshot=fmt,
            ))
            continue

        for sent_idx, sent in enumerate(sentences):
            sent_text = sent.text.strip()
            if not sent_text:
                continue
            # Each sentence shares the parent block's format snapshot.
            # The regenerator will join translated sentences back into the block.
            _add(_make_segment(
                document_id=doc_id,
                text=sent_text,
                seg_type="sentence",
                block_index=block_index,
                sentence_index=sent_idx,
                parent_id=block_id,
                block_type=block_type,
                format_snapshot=fmt,
            ))

    logger.info(
        f"Segmentation v3: {len(segments)} segments from {len(blocks)} blocks "
        f"({sum(1 for s in segments if s.get('status')=='skip')} pass-through)."
    )
    return segments