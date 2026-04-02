import pytest
from app.services.segmenter import segment_blocks

def test_segmenter_retains_duplicates():
    """Ensure segmenter preserves duplicate segments instead of dropping them."""
    blocks = [
        {
            "id": "block1",
            "document_id": "doc1",
            "block_type": "paragraph",
            "text": "Executive Summary",
            "position": {"block_index": 0, "sentence_index": None, "phrase_index": None},
        },
        {
            "id": "block2",
            "document_id": "doc1",
            "block_type": "heading",
            "text": "Executive Summary",
            "position": {"block_index": 1, "sentence_index": None, "phrase_index": None},
            "level": 1,
        }
    ]
    
    segments = segment_blocks(blocks)
    
    assert len(segments) == 2
    assert segments[0]["text"] == "Executive Summary"
    assert segments[1]["text"] == "Executive Summary"
    assert segments[0]["block_type"] == "paragraph"
    assert segments[1]["block_type"] == "heading"
