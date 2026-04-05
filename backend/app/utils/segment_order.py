from __future__ import annotations

from typing import Any, Dict, Iterable, List


_MISSING_INDEX = 10**9


def _value_from_segment(segment: Any, key: str, default: Any = None) -> Any:
    if isinstance(segment, dict):
        return segment.get(key, default)
    return getattr(segment, key, default)


def _normalize_index(value: Any) -> int:
    if isinstance(value, int):
        return value
    return _MISSING_INDEX


def segment_sort_key(segment: Any) -> tuple[int, int, int, int, int, str]:
    position = _value_from_segment(segment, "position", {}) or {}
    if not isinstance(position, dict):
        position = {}

    segment_id = _value_from_segment(segment, "id", "") or ""

    return (
        _normalize_index(position.get("block_index")),
        _normalize_index(position.get("sentence_index")),
        _normalize_index(position.get("phrase_index")),
        _normalize_index(_value_from_segment(segment, "row")),
        _normalize_index(_value_from_segment(segment, "col")),
        str(segment_id),
    )


def sort_segments(segments: Iterable[Any]) -> List[Any]:
    return sorted(segments, key=segment_sort_key)
