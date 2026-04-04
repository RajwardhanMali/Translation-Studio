"""
Source validation service — v3 (LLM-first).

Architecture:
  Layer 1 (Fast Guard): Single rule — double spaces. Zero false-positive risk.
    Runs on every call, provides instant auto-fix capability.

  Layer 2 (LLM Agent): The single source of truth for ALL linguistic analysis.
    Covers 5 categories:
      1. SPELLING     — Misspellings, typos (domain-aware via document context)
      2. GRAMMAR      — Subject-verb agreement, tense, articles, wrong-word
      3. CONSISTENCY  — Terminology variations across the document
      4. PUNCTUATION  — Missing/extra/incorrect punctuation
      5. FORMATTING   — Capitalization, number formatting, spacing issues

  The LLM receives document classification context (type, domain, register,
  domain_keywords) and cross-segment term frequency summaries to provide
  highly accurate, context-aware validation with no false positives.

  enable_ai=True activates Layer 2. When False, only double-space
  detection runs (free, instant).
"""

import re
import json
import logging
from typing import List, Tuple, Dict, Optional, Any
from collections import Counter

logger = logging.getLogger(__name__)


# ===========================================================================
# LAYER 1: Fast Guard (single rule, zero false positives)
# ===========================================================================

_DOUBLE_SPACE_PATTERN = re.compile(r"  +")


def _fast_guard(text: str) -> List[Dict]:
    """
    Layer 1: Only detect double spaces — the ONE deterministic rule
    with truly zero false-positive risk.
    """
    issues = []
    for m in _DOUBLE_SPACE_PATTERN.finditer(text):
        issues.append({
            "issue_type": "formatting",
            "issue":      "Double space detected",
            "suggestion": "Replace with a single space",
            "severity":   "warning",
            "offset":     m.start(),
            "length":     len(m.group(0)),
            "source":     "deterministic",
            "confidence": 1.0,
        })
    return issues


def _auto_fix(text: str) -> str:
    """Auto-fix deterministic issues (double spaces only)."""
    return _DOUBLE_SPACE_PATTERN.sub(" ", text)


# ===========================================================================
# LAYER 2: LLM Agent (comprehensive contextual validation)
# ===========================================================================

_VALIDATION_SYSTEM_PROMPT = """You are an expert editor, proofreader, and language quality analyst for enterprise documents. Your task is to analyze text for quality issues that a machine translation pipeline will consume.

You MUST return ONLY a valid JSON array. No markdown, no explanation, no wrapping — just the raw JSON array.

Analyze the text across these 5 categories:

1. SPELLING — Misspellings, typos. Do NOT flag:
   - Proper nouns, brand names, company names
   - Domain-specific technical terms or jargon
   - Standard abbreviations (e.g., CAGR, EBITDA, API)
   - Words that are correct in context

2. GRAMMAR — Subject-verb disagreement, wrong tense, missing/extra articles, wrong-word usage (e.g., "loose" vs "lose", "their" vs "there", "affect" vs "effect")

3. CONSISTENCY — Flag ONLY when you see genuinely inconsistent notation within the provided text (e.g., "p.m." in one place and "PM" in another). Do NOT flag a term that appears in only one form.

4. PUNCTUATION — Missing periods, wrong comma usage, misused semicolons. Do NOT flag stylistic punctuation choices that are valid in context.

5. FORMATTING — Inconsistent capitalization of the same term, inconsistent number formatting (mixing "10" and "ten" in same context), spacing around special characters.

For each issue found, return an object with these exact keys:
{
  "issue_type": "spelling" | "grammar" | "consistency" | "punctuation" | "formatting" | "wrong_word" | "clarity",
  "severity": "error" | "warning" | "info",
  "issue": "clear description of the problem",
  "suggestion": "the corrected version of the problematic span",
  "span": "the exact problematic text from the input",
  "confidence": 0.0 to 1.0
}

Severity guide:
- "error": Changes meaning, factually broken grammar, wrong word that alters semantics
- "warning": Likely a mistake but text is still understandable
- "info": Style suggestion that improves readability but is not wrong

Critical rules:
1. If the text is clean, return an empty array: []
2. Be precise with "span" — copy the EXACT text from the input.
3. Keep confidence > 0.8 for clear errors, lower for style suggestions.
4. NEVER flag things that are stylistic preferences rather than genuine errors.
5. NEVER flag domain-specific terms, abbreviations, or proper nouns as spelling errors.
6. For consistency: only flag if BOTH variants actually appear in the provided text."""

_DOCUMENT_CONTEXT_ADDITION = """
Document Context:
- Document type: {document_type}
- Domain: {domain}
- Register/tone: {register}
- Domain-specific keywords (do NOT flag these as spelling errors): {domain_keywords}

Use this context to calibrate your analysis. Domain-specific terminology is expected and correct.
"""

_CROSS_SEGMENT_ADDITION = """
Additionally, here is a summary of terminology used across the entire document. Flag any inconsistencies you notice in the text being analyzed (e.g., the text uses "customer" but the rest of the document predominantly uses "client"):

Document Term Summary:
{term_summary}
"""

_BATCH_VALIDATION_USER_PROMPT = """Analyze each of the following text segments for quality issues. Return a JSON object where keys are the segment IDs and values are arrays of issues (same format as above). If a segment is clean, its value should be an empty array.

{segments_block}

Return ONLY the JSON object. No markdown fences, no explanation."""


def _build_ai_validation_prompt(
    text: str,
    term_summary: Optional[str] = None,
    document_context: Optional[Dict] = None,
) -> Tuple[str, str]:
    """Build the system and user prompts for AI validation."""
    system = _VALIDATION_SYSTEM_PROMPT

    if document_context:
        system += _DOCUMENT_CONTEXT_ADDITION.format(
            document_type=document_context.get("document_type", "general"),
            domain=document_context.get("domain", "general"),
            register=document_context.get("register", "formal"),
            domain_keywords=", ".join(document_context.get("domain_keywords", [])) or "none",
        )

    if term_summary:
        system += _CROSS_SEGMENT_ADDITION.format(term_summary=term_summary)

    user = f'Analyze this text for quality issues:\n"""\n{text}\n"""'
    return system, user


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

_VALID_ISSUE_TYPES = {
    "grammar", "spelling", "style", "consistency", "clarity",
    "wrong_word", "punctuation", "formatting",
}


def _parse_ai_response(raw: str) -> List[Dict]:
    """
    Parse the LLM's JSON response into a list of issue dicts.
    Handles common LLM output quirks (markdown fences, wrapper objects, etc.).
    """
    cleaned = raw.strip()
    if not cleaned:
        return []

    # Strip markdown code fences if present
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
        cleaned = cleaned.strip()

    # Handle case where LLM wraps in { "issues": [...] }
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            for key in ("issues", "results", "errors", "data"):
                if key in parsed and isinstance(parsed[key], list):
                    return parsed[key]
            return []
        if isinstance(parsed, list):
            return parsed
        return []
    except json.JSONDecodeError:
        match = re.search(r'\[.*\]', cleaned, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        logger.warning(f"Failed to parse AI validation response: {cleaned[:200]}")
        return []


def _normalize_issue(issue: Dict, text: str) -> Optional[Dict]:
    """Normalize a single AI issue dict into our standard format."""
    if not isinstance(issue, dict):
        return None

    issue_type = issue.get("issue_type", "grammar")
    if issue_type not in _VALID_ISSUE_TYPES:
        issue_type = "grammar"

    severity = issue.get("severity", "info")
    if severity not in {"error", "warning", "info"}:
        severity = "info"

    description = issue.get("issue", "")
    suggestion = issue.get("suggestion", "")
    span = issue.get("span", "")
    confidence = issue.get("confidence", 0.5)

    if not description:
        return None

    # Calculate offset from span
    offset = None
    length = None
    if span and span in text:
        offset = text.find(span)
        length = len(span)

    try:
        confidence = float(confidence)
        confidence = max(0.0, min(1.0, confidence))
    except (TypeError, ValueError):
        confidence = 0.5

    return {
        "issue_type":  issue_type,
        "issue":       description,
        "suggestion":  suggestion,
        "severity":    severity,
        "offset":      offset,
        "length":      length,
        "confidence":  confidence,
        "source":      "ai",
    }


# ---------------------------------------------------------------------------
# Single-segment AI validation
# ---------------------------------------------------------------------------

def _ai_validate(
    text: str,
    term_summary: Optional[str] = None,
    document_context: Optional[Dict] = None,
) -> List[Dict]:
    """
    Layer 2: Use the LLM to perform context-aware validation on a single text.
    Returns a list of normalized issue dicts.
    """
    if not text or not text.strip():
        return []

    try:
        from app.services.llm_service import _call_llm
    except ImportError:
        logger.warning("LLM service not available — AI validation skipped.")
        return []

    system, user = _build_ai_validation_prompt(text, term_summary, document_context)

    try:
        raw_response = _call_llm(system, user, max_tokens=2048)
    except Exception as e:
        logger.warning(f"AI validation LLM call failed: {e}")
        return []

    raw_issues = _parse_ai_response(raw_response)

    normalized = []
    for issue in raw_issues:
        n = _normalize_issue(issue, text)
        if n:
            normalized.append(n)

    return normalized


# ---------------------------------------------------------------------------
# Batched multi-segment AI validation
# ---------------------------------------------------------------------------

def _ai_validate_batch(
    segments: List[Dict],
    term_summary: Optional[str] = None,
    batch_size: int = 5,
    document_context: Optional[Dict] = None,
) -> Dict[str, List[Dict]]:
    """
    Batch AI validation: packs multiple segments into a single LLM call.
    Returns {segment_id: [issues]} mapping.
    """
    try:
        from app.services.llm_service import _call_llm
    except ImportError:
        logger.warning("LLM service not available — AI batch validation skipped.")
        return {}

    results: Dict[str, List[Dict]] = {}

    valid_segments = [
        s for s in segments
        if s.get("text", "").strip() and s.get("status") != "skip"
    ]

    if not valid_segments:
        return results

    for i in range(0, len(valid_segments), batch_size):
        batch = valid_segments[i:i + batch_size]

        segments_block = ""
        for seg in batch:
            sid = seg.get("id", "unknown")
            txt = seg.get("text", "").strip()
            segments_block += f'Segment "{sid}":\n"""\n{txt}\n"""\n\n'

        system = _VALIDATION_SYSTEM_PROMPT
        if document_context:
            system += _DOCUMENT_CONTEXT_ADDITION.format(
                document_type=document_context.get("document_type", "general"),
                domain=document_context.get("domain", "general"),
                register=document_context.get("register", "formal"),
                domain_keywords=", ".join(document_context.get("domain_keywords", [])) or "none",
            )
        if term_summary:
            system += _CROSS_SEGMENT_ADDITION.format(term_summary=term_summary)

        user = _BATCH_VALIDATION_USER_PROMPT.format(segments_block=segments_block)

        try:
            raw_response = _call_llm(system, user, max_tokens=4096)
        except Exception as e:
            logger.warning(f"AI batch validation failed for batch {i//batch_size}: {e}")
            for seg in batch:
                results[seg.get("id", "")] = []
            continue

        parsed = _parse_batch_response(raw_response, batch)
        results.update(parsed)

    return results


def _parse_batch_response(raw: str, batch: List[Dict]) -> Dict[str, List[Dict]]:
    """Parse a batch AI validation response into per-segment issue lists."""
    cleaned = raw.strip()

    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
        cleaned = cleaned.strip()

    results: Dict[str, List[Dict]] = {}

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError:
                return {seg.get("id", ""): [] for seg in batch}
        else:
            return {seg.get("id", ""): [] for seg in batch}

    if not isinstance(parsed, dict):
        return {seg.get("id", ""): [] for seg in batch}

    for seg in batch:
        sid = seg.get("id", "")
        text = seg.get("text", "")
        raw_issues = parsed.get(sid, [])
        if not isinstance(raw_issues, list):
            raw_issues = []

        normalized = []
        for issue in raw_issues:
            n = _normalize_issue(issue, text)
            if n:
                normalized.append(n)

        results[sid] = normalized

    return results


# ===========================================================================
# Cross-segment consistency analysis
# ===========================================================================

def _build_term_summary(segments: List[Dict]) -> Optional[str]:
    """
    Extract significant terms from all segments and build a frequency summary.
    This is passed to the AI agent so it can flag cross-document inconsistencies
    (e.g., "client" used 12 times vs "customer" used 3 times).
    """
    all_text = " ".join(seg.get("text", "") for seg in segments if seg.get("text"))
    if not all_text.strip():
        return None

    stop_words = {
        "the", "and", "for", "are", "but", "not", "you", "all", "can", "has",
        "her", "was", "one", "our", "out", "its", "his", "how", "man", "new",
        "now", "old", "see", "way", "who", "did", "get", "got", "had", "may",
        "say", "she", "too", "use", "also", "been", "from", "have", "into",
        "just", "like", "make", "many", "more", "most", "much", "must", "name",
        "only", "over", "some", "such", "take", "than", "that", "them", "then",
        "this", "very", "when", "will", "with", "each", "what", "were", "which",
        "their", "there", "these", "those", "about", "after", "other", "would",
        "could", "should", "being", "first", "where", "between", "through",
    }

    words = re.findall(r"\b[a-zA-Z]{3,}\b", all_text.lower())
    words = [w for w in words if w not in stop_words and not w.isupper()]

    counter = Counter(words)
    frequent = {term: count for term, count in counter.items() if count >= 2}

    if not frequent:
        return None

    sorted_terms = sorted(frequent.items(), key=lambda x: -x[1])[:50]
    lines = [f"  {term}: {count}x" for term, count in sorted_terms]
    return "\n".join(lines)


# ===========================================================================
# Issue deduplication (merge Layer 1 + Layer 2)
# ===========================================================================

def _merge_issues(
    deterministic_issues: List[Dict],
    ai_issues: List[Dict],
) -> List[Dict]:
    """
    Merge issues from both layers, deduplicating overlapping detections.

    Strategy:
    - If both layers flag the same span, keep the AI version (richer description)
      but prefer deterministic offset/length (more accurate positioning).
    - AI-only issues are added as-is.
    - Deterministic-only issues are kept as-is.
    """
    if not ai_issues:
        return deterministic_issues

    if not deterministic_issues:
        return ai_issues

    merged: List[Dict] = []
    ai_consumed: set = set()

    for det_issue in deterministic_issues:
        det_offset = det_issue.get("offset")
        det_length = det_issue.get("length")

        if det_offset is None or det_length is None:
            merged.append(det_issue)
            continue

        det_start = det_offset
        det_end = det_offset + det_length

        found_overlap = False
        for ai_idx, ai_issue in enumerate(ai_issues):
            if ai_idx in ai_consumed:
                continue

            ai_offset = ai_issue.get("offset")
            ai_length = ai_issue.get("length")

            if ai_offset is None or ai_length is None:
                continue

            ai_start = ai_offset
            ai_end = ai_offset + ai_length

            if ai_start < det_end and ai_end > det_start:
                # Overlap — merge: AI description, deterministic positioning
                merged_issue = {**ai_issue}
                merged_issue["offset"] = det_offset
                merged_issue["length"] = det_length
                merged_issue["source"] = "merged"
                merged.append(merged_issue)
                ai_consumed.add(ai_idx)
                found_overlap = True
                break

        if not found_overlap:
            merged.append(det_issue)

    # Add AI-only issues (not consumed by merge)
    for ai_idx, ai_issue in enumerate(ai_issues):
        if ai_idx not in ai_consumed:
            merged.append(ai_issue)

    return merged


# ===========================================================================
# Public API
# ===========================================================================

def validate_text(
    text: str,
    segment_id: Optional[str] = None,
    auto_fix: bool = False,
    min_issue_severity: str = "warning",
    enable_ai: bool = False,
    term_summary: Optional[str] = None,
    document_context: Optional[Dict] = None,
) -> Dict:
    """
    Validate source text with LLM-first architecture.

    Args:
        text: The source text to validate.
        segment_id: Optional segment identifier.
        auto_fix: If True, apply deterministic auto-fixes (double spaces).
        min_issue_severity: Filter threshold ("info", "warning", "error").
        enable_ai: If True, run LLM-powered comprehensive validation.
        term_summary: Optional cross-document term frequency summary.
        document_context: Dict with document_type, domain, register, domain_keywords.
    """
    # ── Layer 1: Fast guard (double spaces only) ─────────────────────
    deterministic_issues = _fast_guard(text)

    # ── Layer 2: LLM Agent (comprehensive, opt-in) ──────────────────
    ai_issues: List[Dict] = []
    if enable_ai:
        ai_issues = _ai_validate(
            text,
            term_summary=term_summary,
            document_context=document_context,
        )

    # ── Merge & deduplicate ──────────────────────────────────────────
    all_issues = _merge_issues(deterministic_issues, ai_issues)

    # Severity filter
    _order = {"info": 0, "warning": 1, "error": 2}
    threshold = _order.get(min_issue_severity, 1)
    all_issues = [i for i in all_issues if _order.get(i["severity"], 0) >= threshold]

    if segment_id:
        for issue in all_issues:
            issue["segment_id"] = segment_id

    fixed_text = _auto_fix(text) if auto_fix else None

    return {
        "segment_id":      segment_id,
        "text":            text,
        "issues":          all_issues,
        "auto_fixed_text": fixed_text,
        "has_errors":      any(i["severity"] == "error"   for i in all_issues),
        "has_warnings":    any(i["severity"] == "warning" for i in all_issues),
    }


def validate_segments(
    segments: List[Dict],
    auto_fix: bool = False,
    only_with_issues: bool = True,
    enable_ai: bool = False,
    document_context: Optional[Dict] = None,
) -> List[Dict]:
    """
    Validate a list of segment dicts.

    When enable_ai=True:
    1. Builds a cross-document term summary from ALL segments.
    2. Sends segments in batched LLM calls for AI validation.
    3. Merges AI issues with deterministic issues per-segment.
    """
    term_summary = None
    ai_results: Dict[str, List[Dict]] = {}

    if enable_ai:
        term_summary = _build_term_summary(segments)
        ai_results = _ai_validate_batch(
            segments,
            term_summary=term_summary,
            document_context=document_context,
        )

    results = []
    for seg in segments:
        seg_id = seg.get("id")
        text = seg.get("text", "")

        if not text.strip() or seg.get("status") == "skip":
            continue

        # Layer 1: fast guard
        deterministic_issues = _fast_guard(text)

        # Layer 2: AI (already computed in batch)
        ai_issues = ai_results.get(seg_id, [])

        # Merge
        all_issues = _merge_issues(deterministic_issues, ai_issues)

        # Severity filter (warning+)
        _order = {"info": 0, "warning": 1, "error": 2}
        all_issues = [i for i in all_issues if _order.get(i["severity"], 0) >= 1]

        if seg_id:
            for issue in all_issues:
                issue["segment_id"] = seg_id

        fixed_text = _auto_fix(text) if auto_fix else None

        result = {
            "segment_id":      seg_id,
            "text":            text,
            "issues":          all_issues,
            "auto_fixed_text": fixed_text,
            "has_errors":      any(i["severity"] == "error"   for i in all_issues),
            "has_warnings":    any(i["severity"] == "warning" for i in all_issues),
        }

        if only_with_issues and not result["issues"]:
            continue
        results.append(result)

    return results


# ===========================================================================
# Segment text operations (for user edits & AI auto-fix)
# ===========================================================================

def apply_ai_fixes(
    segments: List[Dict],
    segment_ids: Optional[List[str]] = None,
    document_context: Optional[Dict] = None,
) -> Dict:
    """
    Run AI validation on specified segments and auto-apply the suggestions.

    For each segment:
    1. Run AI validation to get issues with suggestions.
    2. Apply suggestions by replacing spans in the original text.
    3. Update segment text in-place.

    Args:
        segments: List of segment dicts (modified in-place).
        segment_ids: If provided, only fix these segments. Otherwise fix all.
        document_context: Classification context for the LLM.

    Returns:
        { "fixed_count": int, "fixes": [{ segment_id, original, fixed, issues_fixed }] }
    """
    target_ids = set(segment_ids) if segment_ids else None

    # Get AI validation results
    term_summary = _build_term_summary(segments)
    target_segments = [
        s for s in segments
        if s.get("text", "").strip()
        and s.get("status") != "skip"
        and (target_ids is None or s.get("id") in target_ids)
    ]

    if not target_segments:
        return {"fixed_count": 0, "fixes": []}

    ai_results = _ai_validate_batch(
        target_segments,
        term_summary=term_summary,
        document_context=document_context,
    )

    fixes = []
    seg_index = {s["id"]: s for s in segments if "id" in s}

    for seg in target_segments:
        sid = seg.get("id")
        original_text = seg.get("text", "")
        issues = ai_results.get(sid, [])

        if not issues:
            continue

        # Apply fixes from right to left (so offsets don't shift)
        fixable = [
            i for i in issues
            if i.get("offset") is not None
            and i.get("length") is not None
            and i.get("suggestion")
            and i.get("severity") in ("error", "warning")
        ]
        fixable.sort(key=lambda i: i["offset"], reverse=True)

        fixed_text = original_text
        applied = []
        for issue in fixable:
            start = issue["offset"]
            end = start + issue["length"]
            span = fixed_text[start:end]

            # Verify the span still matches what AI expects
            if issue.get("span") and span != issue["span"]:
                continue

            fixed_text = fixed_text[:start] + issue["suggestion"] + fixed_text[end:]
            applied.append(issue)

        if applied and fixed_text != original_text:
            # Update the segment in-place
            if sid in seg_index:
                seg_index[sid]["text"] = fixed_text
            seg["text"] = fixed_text

            fixes.append({
                "segment_id":   sid,
                "original":     original_text,
                "fixed":        fixed_text,
                "issues_fixed": len(applied),
            })

    return {"fixed_count": len(fixes), "fixes": fixes}


def update_segment_text(
    segments: List[Dict],
    segment_id: str,
    new_text: str,
) -> Optional[Dict]:
    """
    Update a segment's text with user-provided content.

    Used when the user manually edits a flagged segment before translation.
    Returns the updated segment dict, or None if not found.
    """
    for seg in segments:
        if seg.get("id") == segment_id:
            old_text = seg.get("text", "")
            seg["text"] = new_text
            seg["status"] = "edited"
            logger.info(f"Segment {segment_id} text updated by user.")
            return {
                "segment_id": segment_id,
                "old_text":   old_text,
                "new_text":   new_text,
                "status":     "edited",
            }
    return None