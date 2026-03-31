"""
RAG + Translation Memory engine — language-aware.

Root cause fixed in this version:
  LANGUAGE BLEED: classify_segment() never filtered by target_language.
  A French translation stored for "Hello" would be returned when searching
  for a German translation of the same text, because FAISS only scores by
  vector similarity — it has no concept of language.

  Fix strategy:
    The FAISS index stores ALL languages together (one index for all).
    When searching, we retrieve the top-K nearest neighbours (K = min(50, ntotal))
    then filter that candidate list to only entries matching target_language,
    and return the best match from the filtered set.

    Why not a separate index per language?
      - Simpler ops (one file pair, not N)
      - Languages share the same semantic space, so one IndexFlatIP works fine
      - Post-filter on metadata is fast (metadata is a Python list, filtering
        50 entries is microseconds)

    Why top-K = 50?
      - For a 1000-entry TM you might have 100 French, 100 German, etc.
        Fetching only top-1 risks missing the best same-language match.
        50 is a safe ceiling that makes it statistically very unlikely the
        best same-language match falls outside the retrieved set, while
        keeping the filter loop trivially fast.
      - Capped at ntotal so it never over-asks.

  Additional fix: store() now also checks for exact duplicate
  (same source_text + language already in metadata) to avoid
  the TM growing unboundedly with repeated translations.
"""

import logging
import pickle
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any

import numpy as np

logger = logging.getLogger(__name__)

EXACT_THRESHOLD = 0.95
FUZZY_THRESHOLD = 0.75
SEARCH_TOP_K    = 50      # candidates to retrieve before language filter

from app.utils.file_handler import FAISS_DIR

INDEX_PATH    = FAISS_DIR / "tm.index"
METADATA_PATH = FAISS_DIR / "tm_metadata.pkl"


def _load_faiss():
    try:
        import faiss
        return faiss
    except ImportError:
        raise RuntimeError("faiss-cpu is not installed. Run: pip install faiss-cpu")


class TranslationMemory:
    def __init__(self):
        self._faiss    = None
        self.index     = None
        self.metadata: List[Dict] = []
        self._dim: Optional[int]  = None

    @property
    def faiss(self):
        if self._faiss is None:
            self._faiss = _load_faiss()
        return self._faiss

    # ── Persistence ──────────────────────────────────────────────────────────

    def load(self) -> None:
        if INDEX_PATH.exists() and METADATA_PATH.exists():
            try:
                self.index = self.faiss.read_index(str(INDEX_PATH))
                with open(METADATA_PATH, "rb") as f:
                    self.metadata = pickle.load(f)
                self._dim = self.index.d
                logger.info(f"TM loaded: {self.index.ntotal} entries, dim={self._dim}")
                return
            except Exception as e:
                logger.error(f"TM load failed: {e} — starting fresh.")
        self.index    = None
        self.metadata = []
        self._dim     = None
        logger.info("TM initialised empty.")

    def save(self) -> None:
        if self.index is None:
            return
        try:
            self.faiss.write_index(self.index, str(INDEX_PATH))
            with open(METADATA_PATH, "wb") as f:
                pickle.dump(self.metadata, f)
            logger.debug(f"TM saved: {self.index.ntotal} entries.")
        except Exception as e:
            logger.error(f"TM save failed: {e}")

    def _ensure_index(self, dim: int) -> None:
        if self.index is not None and self._dim == dim:
            return
        if self.index is not None and self._dim != dim:
            logger.warning(
                f"TM dim mismatch: index={self._dim}, encoder={dim}. "
                "Re-initialising — existing entries lost."
            )
            self.metadata = []
        self._dim  = dim
        self.index = self.faiss.IndexFlatIP(dim)
        logger.info(f"FAISS index created (dim={dim}).")

    # ── Language-aware search ─────────────────────────────────────────────────

    def search(
        self,
        query_vec: np.ndarray,
        target_language: str,
        top_k: int = SEARCH_TOP_K,
    ) -> Tuple[Optional[Dict], float]:
        """
        Find the best TM match for query_vec that is in target_language.

        Steps:
          1. Ask FAISS for the top_k nearest neighbours by cosine similarity.
          2. Filter those candidates to entries where language == target_language.
          3. Return the highest-scoring filtered candidate.

        If no candidate in the target language is found within top_k results,
        return (None, 0.0) so the caller falls through to LLM translation.
        """
        if self.index is None or self.index.ntotal == 0:
            return None, 0.0

        vec    = query_vec.reshape(1, -1).astype(np.float32)
        k      = min(top_k, self.index.ntotal)
        distances, indices = self.index.search(vec, k)

        best_meta  = None
        best_score = 0.0

        for idx, score in zip(indices[0], distances[0]):
            if idx == -1:
                continue
            meta = self.metadata[int(idx)]
            # ── Language filter — this is the core bug fix ──────────────────
            if meta.get("language", "").lower() != target_language.lower():
                continue
            # First matching entry is the best (FAISS returns sorted by score)
            best_meta  = meta
            best_score = float(score)
            break

        return best_meta, best_score

    # ── Dedup helper ──────────────────────────────────────────────────────────

    def _is_duplicate(self, source_text: str, language: str) -> bool:
        """Return True if an entry with the same source+language already exists."""
        src_lower = source_text.strip().lower()
        lang_lower = language.lower()
        return any(
            m.get("source_text", "").strip().lower() == src_lower
            and m.get("language", "").lower() == lang_lower
            for m in self.metadata
        )

    # ── Add (single — for approval path) ─────────────────────────────────────

    def add_entry(
        self,
        embedding: np.ndarray,
        source_text: str,
        target_text: str,
        language: str,
        segment_id: Optional[str] = None,
        document_id: Optional[str] = None,
    ) -> None:
        if self._is_duplicate(source_text, language):
            # Update the existing entry's target_text (human correction wins)
            src_lower  = source_text.strip().lower()
            lang_lower = language.lower()
            for m in self.metadata:
                if (
                    m.get("source_text", "").strip().lower() == src_lower
                    and m.get("language", "").lower() == lang_lower
                ):
                    m["target_text"]  = target_text
                    m["segment_id"]   = segment_id
                    m["document_id"]  = document_id
                    break
            self.save()
            logger.debug(f"TM updated existing entry ({language}): '{source_text[:50]}'")
            return

        vec = embedding.reshape(1, -1).astype(np.float32)
        self._ensure_index(vec.shape[1])
        self.index.add(vec)
        self.metadata.append({
            "source_text":  source_text,
            "target_text":  target_text,
            "language":     language,
            "segment_id":   segment_id,
            "document_id":  document_id,
        })
        self.save()
        logger.debug(f"TM added ({language}): '{source_text[:50]}'")

    # ── Add (batch — for post-translation auto-populate) ─────────────────────

    def add_entries_batch(self, entries: List[Dict]) -> int:
        """
        Add multiple entries, skipping duplicates (same source_text + language).
        Saves once after all entries are added.
        """
        if not entries:
            return 0

        new_entries  = []
        skipped      = 0
        update_count = 0

        for e in entries:
            src  = e["source_text"]
            lang = e["language"]
            if self._is_duplicate(src, lang):
                # Only update if this is a human correction (has correction field)
                # Auto-translations don't overwrite existing entries
                if e.get("is_correction"):
                    for m in self.metadata:
                        if (
                            m.get("source_text", "").strip().lower() == src.strip().lower()
                            and m.get("language", "").lower() == lang.lower()
                        ):
                            m["target_text"] = e["target_text"]
                            update_count += 1
                            break
                else:
                    skipped += 1
                continue
            new_entries.append(e)

        if new_entries:
            vecs = np.stack(
                [e["embedding"].reshape(-1) for e in new_entries]
            ).astype(np.float32)
            self._ensure_index(vecs.shape[1])
            self.index.add(vecs)
            for e in new_entries:
                self.metadata.append({
                    "source_text":  e["source_text"],
                    "target_text":  e["target_text"],
                    "language":     e["language"],
                    "segment_id":   e.get("segment_id"),
                    "document_id":  e.get("document_id"),
                })

        self.save()
        logger.info(
            f"TM batch: {len(new_entries)} added, {skipped} skipped (dup), "
            f"{update_count} updated. Total: {self.index.ntotal if self.index else 0}"
        )
        return len(new_entries)


# ── Singleton ─────────────────────────────────────────────────────────────────

_tm: Optional[TranslationMemory] = None


def get_tm() -> TranslationMemory:
    global _tm
    if _tm is None:
        _tm = TranslationMemory()
        _tm.load()
    return _tm


# ── Public API ────────────────────────────────────────────────────────────────

def classify_segment(
    source_text: str,
    embedding: np.ndarray,
    target_language: str,          # ← required now, no default
) -> Tuple[str, Optional[str], float]:
    """
    Classify a segment against the TM for a specific target language.

    Returns:
        (match_type, tm_translation | None, score)
        match_type ∈ {"exact", "fuzzy", "new"}
    """
    tm = get_tm()
    meta, score = tm.search(embedding, target_language=target_language)

    if meta is None or score < FUZZY_THRESHOLD:
        return "new", None, score

    tm_translation = meta.get("target_text")

    if score >= EXACT_THRESHOLD:
        logger.info(
            f"TM exact ({score:.3f}) [{target_language}]: '{source_text[:50]}'"
        )
        return "exact", tm_translation, score

    logger.info(
        f"TM fuzzy ({score:.3f}) [{target_language}]: '{source_text[:50]}'"
    )
    return "fuzzy", tm_translation, score


def store_translation(
    source_text: str,
    target_text: str,
    language: str,
    embedding: np.ndarray,
    segment_id: Optional[str] = None,
    document_id: Optional[str] = None,
) -> None:
    """Store a single approved (human-corrected) translation."""
    get_tm().add_entry(
        embedding=embedding,
        source_text=source_text,
        target_text=target_text,
        language=language,
        segment_id=segment_id,
        document_id=document_id,
    )


def store_translations_batch(
    segments: List[Dict],
    target_language: str,
) -> int:
    """
    Auto-populate TM after translation (no human approval needed).
    Skips entries that already exist for this language — existing entries
    are only overwritten when is_correction=True (from approval path).
    """
    from app.utils.embeddings import encode_texts

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

    entries = [
        {
            "embedding":    emb,
            "source_text":  seg["text"].strip(),
            "target_text":  seg["translated_text"].strip(),
            "language":     target_language,
            "segment_id":   seg.get("id"),
            "document_id":  seg.get("document_id"),
            "is_correction": False,   # auto-translated, don't overwrite existing
        }
        for seg, emb in zip(eligible, embeddings)
    ]

    return get_tm().add_entries_batch(entries)