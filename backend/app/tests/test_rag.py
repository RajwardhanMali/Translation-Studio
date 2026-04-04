import pytest
import numpy as np
from pathlib import Path

from app.services.rag_engine import (
    TranslationMemory,
    get_tm,
    store_translation,
    classify_segment,
    store_translations_batch,
    EXACT_THRESHOLD
)
from app.utils.file_handler import FAISS_DIR

def test_language_bleed_fix():
    tm = TranslationMemory()
    # Fake vector for "Hello"
    fake_vec = np.ones((1, 384)).astype(np.float32)

    # 1. Fill TM with "Hello" in 60 different other languages
    # This proves the new architecture handles 50+ matches cleanly
    for i in range(60):
        lang = f"lang_{i}"
        tm.add_entry(
            embedding=fake_vec.copy(),
            source_text="Hello",
            target_text=f"Hello_{lang}",
            language=lang,
        )
    
    # 2. Add the actual target language we want (e.g. French)
    tm.add_entry(
        embedding=fake_vec.copy(),
        source_text="Hello",
        target_text="Bonjour",
        language="fr",
    )

    # 3. Query TM for "fr". 
    # If the truncation bug existed (K=50 monolithic index), "fr" might be truncated out.
    meta, score = tm.search(fake_vec, target_language="fr")
    
    assert meta is not None
    assert meta["target_text"] == "Bonjour"
    assert meta["language"] == "fr"
    # Should be an exact match
    assert score >= EXACT_THRESHOLD

def test_tm_update_correction():
    tm = TranslationMemory()
    vec = np.zeros((1, 384)).astype(np.float32)
    
    tm.add_entry(embedding=vec, source_text="Test", target_text="Old", language="fr")
    
    # User provides a correction, overrides existing entry
    tm.add_entry(embedding=vec, source_text="Test", target_text="New Cor", language="fr")
    
    meta, score = tm.search(vec, target_language="fr")
    assert meta["target_text"] == "New Cor"

def test_store_batch_skips_duplicates_unless_correction():
    tm = TranslationMemory()
    vec = np.random.rand(1, 384).astype(np.float32)
    
    entries = [
        {
            "embedding": vec,
            "source_text": "Batch1",
            "target_text": "Trans1",
            "language": "es",
            "is_correction": False
        }
    ]
    tm.add_entries_batch(entries)
    
    # Try adding again (auto-translation doesn't replace it or duplicate it)
    entries[0]["target_text"] = "Trans1_diff"
    added = tm.add_entries_batch(entries)
    assert added == 0  # skipped
    
    # Verify not overwritten
    meta, score = tm.search(vec, "es")
    assert meta["target_text"] == "Trans1"
    
    # Now provide as correction
    entries[0]["target_text"] = "Trans1_correction"
    entries[0]["is_correction"] = True
    added = tm.add_entries_batch(entries)
    
    # Verify overwritten
    meta, score = tm.search(vec, "es")
    assert meta["target_text"] == "Trans1_correction"
