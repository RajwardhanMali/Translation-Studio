"""
RAG + Translation Memory engine — language-aware (v4).

Architecture change:
  MULTI-INDEX TM: We now use a separate FAISS index and metadata list
  for EACH target language.

  This fully solves the "Language Bleed / Top-K Truncation" issue:
    Before: A single monolithic index meant `K=50` could be filled with
            identical source texts from 50 OTHER languages, truncating
            the actual target language and missing the TM hit.
    Now: When translating to French, we only ever query `tm_fr.index`.
         It is computationally impossible to bleed languages.
         Top-K is completely safe (K=5 is enough) because all results
         are guaranteed to be in the requested language.
"""

import logging
import pickle
from pathlib import Path
from typing import Optional, Tuple, List, Dict, Any

import numpy as np

logger = logging.getLogger(__name__)

EXACT_THRESHOLD = 0.95
FUZZY_THRESHOLD = 0.75
SEARCH_TOP_K    = 5       # candidates to retrieve (now completely safe since it's per-language)

from app.utils.file_handler import FAISS_DIR

def _load_faiss():
    try:
        import faiss
        return faiss
    except ImportError:
        raise RuntimeError("faiss-cpu is not installed. Run: pip install faiss-cpu")


class TranslationMemory:
    def __init__(self):
        self._faiss = None
        # Maps language code -> FAISS index
        self.indices: Dict[str, Any] = {}
        # Maps language code -> List of metadata dicts
        self.metadata: Dict[str, List[Dict]] = {}
        # Maps language code -> Embedding dimension
        self._dims: Dict[str, int] = {}

    @property
    def faiss(self):
        if self._faiss is None:
            self._faiss = _load_faiss()
        return self._faiss

    def _get_index_path(self, language: str) -> Path:
        return FAISS_DIR / f"tm_{language.lower()}.index"

    def _get_meta_path(self, language: str) -> Path:
        return FAISS_DIR / f"tm_metadata_{language.lower()}.pkl"

    # ── Persistence ──────────────────────────────────────────────────────────

    def load(self) -> None:
        """Load all per-language TM indices from disk."""
        self.indices.clear()
        self.metadata.clear()
        self._dims.clear()
        
        # Look for existing tm_metadata_*.pkl files
        meta_files = list(FAISS_DIR.glob("tm_metadata_*.pkl"))
        
        for meta_path in meta_files:
            # Extract language code from filename: tm_metadata_fr.pkl -> fr
            lang = meta_path.stem.replace("tm_metadata_", "")
            idx_path = self._get_index_path(lang)
            
            if idx_path.exists():
                try:
                    index = self.faiss.read_index(str(idx_path))
                    with open(meta_path, "rb") as f:
                        meta = pickle.load(f)
                    
                    self.indices[lang] = index
                    self.metadata[lang] = meta
                    self._dims[lang] = index.d
                    logger.info(f"TM loaded [{lang}]: {index.ntotal} entries, dim={index.d}")
                except Exception as e:
                    logger.error(f"TM load failed for [{lang}]: {e} — resetting this language.")
                    
        if not self.indices:
            logger.info("TM initialised empty (multi-index).")

    def save_language(self, language: str) -> None:
        """Save a specific language's index to disk."""
        lang = language.lower()
        if lang not in self.indices:
            return
            
        try:
            self.faiss.write_index(self.indices[lang], str(self._get_index_path(lang)))
            with open(self._get_meta_path(lang), "wb") as f:
                pickle.dump(self.metadata[lang], f)
            logger.debug(f"TM saved [{lang}]: {self.indices[lang].ntotal} entries.")
        except Exception as e:
            logger.error(f"TM save failed for [{lang}]: {e}")

    def save_all(self) -> None:
        """Save all loaded indices."""
        for lang in self.indices.keys():
            self.save_language(lang)

    def _ensure_index(self, language: str, dim: int) -> None:
        lang = language.lower()
        if lang in self.indices and self._dims.get(lang) == dim:
            return
            
        if lang in self.indices and self._dims.get(lang) != dim:
            logger.warning(
                f"TM dim mismatch for [{lang}]: index={self._dims.get(lang)}, encoder={dim}. "
                "Re-initialising — existing entries lost."
            )
            self.metadata[lang] = []
            
        self._dims[lang]  = dim
        self.indices[lang] = self.faiss.IndexFlatIP(dim)
        if lang not in self.metadata:
            self.metadata[lang] = []
            
        logger.info(f"FAISS index created for [{lang}] (dim={dim}).")

    # ── Language-aware search ─────────────────────────────────────────────────

    def search(
        self,
        query_vec: np.ndarray,
        target_language: str,
        top_k: int = SEARCH_TOP_K,
    ) -> Tuple[Optional[Dict], float]:
        """
        Find the best TM match for query_vec strictly in target_language.
        Because queries route entirely to the language's own index, bleeding is impossible.
        """
        lang = target_language.lower()
        idx = self.indices.get(lang)
        
        if idx is None or idx.ntotal == 0:
            return None, 0.0

        vec = query_vec.reshape(1, -1).astype(np.float32)
        k   = min(top_k, idx.ntotal)
        
        distances, hit_indices = idx.search(vec, k)

        best_meta  = None
        best_score = 0.0

        # We return the top result unconditionally, because ALL results 
        # in this index are by definition the correct language.
        for faiss_id, score in zip(hit_indices[0], distances[0]):
            if faiss_id == -1:
                continue
            
            best_meta  = self.metadata[lang][int(faiss_id)]
            best_score = float(score)
            break

        return best_meta, best_score

    # ── Add & Update ──────────────────────────────────────────────────────────

    def add_entry(
        self,
        embedding: np.ndarray,
        source_text: str,
        target_text: str,
        language: str,
        segment_id: Optional[str] = None,
        document_id: Optional[str] = None,
    ) -> None:
        lang = language.lower()
        src_lower = source_text.strip().lower()
        
        # Check if identical source already exists in this language
        if lang in self.metadata:
            for m in self.metadata[lang]:
                if m.get("source_text", "").strip().lower() == src_lower:
                    # Update existing (human correction overwrites)
                    m["target_text"] = target_text
                    m["segment_id"]  = segment_id
                    m["document_id"] = document_id
                    self.save_language(lang)
                    logger.debug(f"TM updated existing entry [{lang}]: '{source_text[:50]}'")
                    return

        # New entry
        vec = embedding.reshape(1, -1).astype(np.float32)
        self._ensure_index(lang, vec.shape[1])
        
        self.indices[lang].add(vec)
        self.metadata[lang].append({
            "source_text":  source_text,
            "target_text":  target_text,
            "language":     language,
            "segment_id":   segment_id,
            "document_id":  document_id,
        })
        self.save_language(lang)
        logger.debug(f"TM added [{lang}]: '{source_text[:50]}'")

    def add_entries_batch(self, entries: List[Dict]) -> int:
        """
        Add multiple entries at once, routing them to their respective language indices.
        Saves modified indices afterward.
        """
        if not entries:
            return 0

        added_count = 0
        langs_modified = set()

        for e in entries:
            lang = e["language"].lower()
            src_lower = e["source_text"].strip().lower()
            
            is_dup = False
            # Check dup
            if lang in self.metadata:
                for m in self.metadata[lang]:
                    if m.get("source_text", "").strip().lower() == src_lower:
                        is_dup = True
                        if e.get("is_correction"):
                            # Update existing
                            m["target_text"] = e["target_text"]
                            langs_modified.add(lang)
                        break
            
            if not is_dup:
                vec = e["embedding"].reshape(1, -1).astype(np.float32)
                self._ensure_index(lang, vec.shape[1])
                self.indices[lang].add(vec)
                self.metadata[lang].append({
                    "source_text":  e["source_text"],
                    "target_text":  e["target_text"],
                    "language":     e["language"],
                    "segment_id":   e.get("segment_id"),
                    "document_id":  e.get("document_id"),
                })
                langs_modified.add(lang)
                added_count += 1

        for lang in langs_modified:
            self.save_language(lang)

        logger.info(f"TM batch: {added_count} new entries added across {len(langs_modified)} languages.")
        return added_count


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
    target_language: str,          
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