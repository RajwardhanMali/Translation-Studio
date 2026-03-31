"""
Embedding utility using sentence-transformers (BAAI/bge-small-en).
Singleton encoder — loaded once, reused on every call.

encode_texts: batch encode (fast, single forward pass)
encode_single: encode one string (returns 1-D array)
"""

import logging
import numpy as np
from typing import List, Union

logger = logging.getLogger(__name__)

_encoder = None
MODEL_NAME = "BAAI/bge-small-en"


def get_encoder():
    global _encoder
    if _encoder is None:
        logger.info(f"Loading sentence-transformer: {MODEL_NAME}")
        try:
            from sentence_transformers import SentenceTransformer
            _encoder = SentenceTransformer(MODEL_NAME)
            logger.info("Encoder ready.")
        except Exception as e:
            logger.error(f"Failed to load encoder: {e}")
            raise
    return _encoder


def encode_texts(texts: Union[str, List[str]]) -> np.ndarray:
    """
    Encode one or more texts into L2-normalised float32 vectors.
    All texts are encoded in a SINGLE forward pass — efficient for batches.

    Returns: np.ndarray of shape (n, 384)
    """
    if isinstance(texts, str):
        texts = [texts]
    if not texts:
        return np.zeros((0, 384), dtype=np.float32)

    encoder = get_encoder()
    embeddings = encoder.encode(
        texts,
        normalize_embeddings=True,
        show_progress_bar=False,
        batch_size=64,          # encoder-level batching (GPU/CPU)
        convert_to_numpy=True,
    )
    return embeddings.astype(np.float32)


def encode_single(text: str) -> np.ndarray:
    """Encode a single string → 1-D float32 array of shape (384,)."""
    return encode_texts([text])[0]