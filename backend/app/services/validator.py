"""
Source validation service — LLM-First Architecture.

Architecture:
  Layer 1 (Fast Guard & Consistency): 
    - Double space detection (zero false positive).
    - Cross-document deterministic consistency (hyphenation/capitalization drift).
      (Handled deterministically as LLMs cannot effectively find document-wide 
       drifts while operating on isolated small text batches).

  Layer 2 (LLM Agent - DEFAULT): 
    - The sole authority for logic, semantics, spelling, grammar, punctuation, and clarity.
    - Processed in robust batches (batch_size=20) to prevent 429 Rate Limits from APIs.
"""

import re
import json
import logging
from typing import List, Tuple, Dict, Optional, Any
from collections import Counter

logger = logging.getLogger(__name__)


# ===========================================================================
# LAYER 1: Fast Guard & Cross-Document Consistency
# ===========================================================================

_DOUBLE_SPACE_PATTERN = re.compile(r"  +")
_TERM_PATTERN = re.compile(r"\b[A-Za-z][A-Za-z0-9-]{2,}\b")
_SEVERITY_ORDER = {"info": 0, "warning": 1, "error": 2}
_STOP_WORDS = {
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

def _fast_guard(text: str) -> List[Dict]:
    """
    Detect double spaces — the ONE deterministic rule with zero false-positive risk.
    """
    issues = []
    for m in _DOUBLE_SPACE_PATTERN.finditer(text):
        issues.append({
            "issue_type": "formatting",
            "issue":      "Double space detected",
            "suggestion": "Replace with a single space",
            "span":       m.group(0),
            "severity":   "warning",
            "offset":     m.start(),
            "length":     len(m.group(0)),
            "source":     "deterministic",
            "confidence": 1.0,
        })
    return issues

def _auto_fix(text: str) -> str:
    """Auto-fix deterministic issues (double spaces)."""
    return _DOUBLE_SPACE_PATTERN.sub(" ", text)

def _canonicalize_term(term: str) -> str:
    """Normalize a term for lightweight terminology consistency checks."""
    return re.sub(r"[^a-z0-9]", "", term.lower())

def _deterministic_consistency_issues(segments: List[Dict]) -> Dict[str, List[Dict]]:
    """
    Flag obvious terminology notation drift across a document.
    Crucial for cross-document continuity that batch-processed LLMs cannot see.
    """
    occurrences: Dict[str, Dict[str, Any]] = {}

    for seg in segments:
        if seg.get("status") == "skip":
            continue

        text = seg.get("text", "") or ""
        seg_id = seg.get("id")
        if not seg_id or not text.strip():
            continue

        for match in _TERM_PATTERN.finditer(text):
            term = match.group(0)
            canonical = _canonicalize_term(term)

            if len(canonical) < 3 or canonical in _STOP_WORDS:
                continue

            entry = occurrences.setdefault(canonical, {"variants": {}, "first_seen": []})
            variant_occurrences = entry["variants"].setdefault(term, [])
            variant_occurrences.append({
                "segment_id": seg_id,
                "offset": match.start(),
                "length": len(term),
                "span": term,
            })
            if term not in entry["first_seen"]:
                entry["first_seen"].append(term)

    issues_by_segment: Dict[str, List[Dict]] = {}

    for entry in occurrences.values():
        variants = entry["variants"]
        if len(variants) < 2:
            continue

        counts = {variant: len(variant_occurrences) for variant, variant_occurrences in variants.items()}
        preferred = max(
            counts.items(),
            key=lambda item: (item[1], -entry["first_seen"].index(item[0])),
        )[0]

        variant_keys = {_canonicalize_term(variant) for variant in variants}
        if len(variant_keys) != 1:
            continue

        for variant, variant_occurrences in variants.items():
            if variant == preferred:
                continue

            only_case_change = variant.lower() == preferred.lower()
            issue_type = "formatting" if only_case_change else "consistency"
            severity = "info" if only_case_change else "warning"

            for occurrence in variant_occurrences:
                seg_id = occurrence["segment_id"]
                issues_by_segment.setdefault(seg_id, []).append({
                    "issue_type": issue_type,
                    "issue": f"Inconsistent terminology variant: '{variant}' differs from preferred '{preferred}' used elsewhere.",
                    "suggestion": preferred,
                    "span": occurrence["span"],
                    "severity": severity,
                    "offset": occurrence["offset"],
                    "length": occurrence["length"],
                    "confidence": 0.9,
                    "source": "deterministic_consistency",
                })

    return issues_by_segment

def _resolve_span_position(
    text: str,
    span: str,
    offset: Optional[int] = None,
    length: Optional[int] = None,
) -> Tuple[Optional[int], Optional[int]]:
    """Resolve the best available position for a reported span."""
    if not span:
        if isinstance(offset, int) and isinstance(length, int):
            return offset, length
        return offset, length

    span_length = len(span)

    if isinstance(offset, int):
        candidate = text[offset:offset + span_length]
        if candidate == span:
            return offset, span_length

    found_at = text.find(span)
    if found_at >= 0:
        return found_at, span_length

    if isinstance(offset, int) and isinstance(length, int):
        return offset, length

    return None, None


# ===========================================================================
# LAYER 2: LLM Agent (comprehensive contextual validation)
# ===========================================================================

_VALIDATION_SYSTEM_PROMPT = """You are an expert editor, proofreader, and language quality analyst for enterprise documents. Your task is to analyze text for quality issues before machine translation.

You MUST return ONLY a valid JSON array. No markdown, no explanation, no wrapping — just the raw JSON array.

Analyze the text across these categories:

1. SPELLING — Misspellings, typos. Do NOT flag:
   - Proper nouns, brand names, company names
   - Domain-specific technical terms or jargon
   - Words that are correct in context

2. GRAMMAR — Subject-verb disagreement, wrong tense, missing/extra articles.

3. WRONG WORD — Homophone confusion (e.g., "loose" vs "lose", "their" vs "there", "affect" vs "effect").

4. PUNCTUATION — Missing periods, wrong comma usage, misused semicolons. Do NOT flag stylistic choices.

5. CLARITY — Awkward phrasing that might confuse a machine translator.

For each issue found, return an object with these exact keys:
{
  "issue_type": "spelling" | "grammar" | "punctuation" | "wrong_word" | "clarity",
  "severity": "error" | "warning" | "info",
  "issue": "clear description of the problem",
  "suggestion": "the corrected version of the problematic span",
  "span": "the exact problematic text from the input",
  "confidence": 0.0 to 1.0
}

Severity guide:
- "error": Changes meaning, factually broken grammar, wrong word that alters semantics
- "warning": Likely a mistake but text is still understandable
- "info": Style suggestion that improves readability

Critical rules:
1. If the text is clean, return an empty array: []
2. Be precise with "span" — copy the EXACT text from the input.
3. Keep confidence > 0.8 for clear errors, lower for style.
4. NEVER flag proper nouns or domain keywords as spelling errors."""

_DOCUMENT_CONTEXT_ADDITION = """
Document Context:
- Document type: {document_type}
- Domain: {domain}
- Register/tone: {register}
- Domain-specific keywords (do NOT flag these as spelling errors): {domain_keywords}

Use this context to calibrate your analysis. Domain-specific terminology is expected and correct.
"""

_BATCH_VALIDATION_USER_PROMPT = """Analyze each of the following text segments for quality issues. Return a JSON object where keys are the segment IDs and values are arrays of issues (same format as above). If a segment is clean, its value should be an empty array.

{segments_block}

Return ONLY the JSON object. No markdown fences, no explanation."""


def _build_ai_validation_prompt(
    text: str,
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

    user = f'Analyze this text for quality issues:\n"""\n{text}\n"""'
    return system, user


_VALID_ISSUE_TYPES = {
    "grammar", "spelling", "style", "consistency", "clarity",
    "wrong_word", "punctuation", "formatting",
}

def _parse_ai_response(raw: str) -> List[Dict]:
    """Parse the LLM's JSON response into a list of issue dicts."""
    cleaned = raw.strip()
    if not cleaned:
        return []

    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
        cleaned = cleaned.strip()

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
    """Normalize a single AI issue dict into standard format."""
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

    offset, length = _resolve_span_position(
        text,
        span,
        offset=issue.get("offset"),
        length=issue.get("length"),
    )

    try:
        confidence = float(confidence)
        confidence = max(0.0, min(1.0, confidence))
    except (TypeError, ValueError):
        confidence = 0.5

    return {
        "issue_type":  issue_type,
        "issue":       description,
        "suggestion":  suggestion,
        "span":        span or None,
        "severity":    severity,
        "offset":      offset,
        "length":      length,
        "confidence":  confidence,
        "source":      "ai",
    }


def _ai_validate_batch(
    segments: List[Dict],
    batch_size: int = 20,
    document_context: Optional[Dict] = None,
) -> Dict[str, Optional[List[Dict]]]:
    """
    Batch AI validation logic.
    Returns Dictionary Mapping Segment ID to a List of Issues.
    If the API fails to process the batch, it returns `None` for those segments' issues to indicate failure.
    """
    try:
        from app.services.llm_service import _call_llm
    except ImportError:
        logger.warning("LLM service not available.")
        # None indicates API failure 
        return {s.get("id"): None for s in segments if s.get("id")}

    results: Dict[str, Optional[List[Dict]]] = {}

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

        user = _BATCH_VALIDATION_USER_PROMPT.format(segments_block=segments_block)

        try:
            logger.info(f"Dispatching AI Validation Batch {i//batch_size + 1}")
            raw_response = _call_llm(system, user, max_tokens=4096)
        except Exception as e:
            logger.warning(f"AI batch validation failed (429 or Timeout) for batch {i//batch_size + 1}: {e}")
            for seg in batch:
                results[seg.get("id", "")] = None # None denotes API Failure, not a clean text array
            continue

        # Parse logic
        cleaned = raw_response.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
            cleaned = re.sub(r"\n?```$", "", cleaned)
            cleaned = cleaned.strip()

        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            match = re.search(r'\{.*\}', cleaned, re.DOTALL)
            if match:
                try:
                    parsed = json.loads(match.group(0))
                except json.JSONDecodeError:
                    parsed = {}
            else:
                parsed = {}

        if not isinstance(parsed, dict):
            parsed = {}

        for seg in batch:
            sid = seg.get("id", "")
            text = seg.get("text", "")
            raw_issues = parsed.get(sid, [])
            
            if not isinstance(raw_issues, list):
                results[sid] = None # LLM returned bad format for this segment
                continue

            normalized = []
            for issue in raw_issues:
                n = _normalize_issue(issue, text)
                if n:
                    normalized.append(n)

            results[sid] = normalized

    return results

# ===========================================================================
# Issue Merge Operator
# ===========================================================================

def _merge_issues(
    deterministic_issues: List[Dict],
    ai_issues: List[Dict],
) -> List[Dict]:
    """Merge issues from both layers, giving priority to AI descriptions on overlaps."""
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
    min_issue_severity: str = "info",
    enable_ai: bool = True,
    document_context: Optional[Dict] = None,
) -> Dict:
    """Validate a single target free-text node using the LLM & Deterministic spacing."""
    deterministic_issues = _fast_guard(text)
    ai_issues: List[Dict] = []
    
    if enable_ai:
        try:
            from app.services.llm_service import _call_llm
            system, user = _build_ai_validation_prompt(text, document_context)
            raw_response = _call_llm(system, user, max_tokens=2048)
            raw_issues = _parse_ai_response(raw_response)
            ai_issues = [_normalize_issue(i, text) for i in raw_issues]
            ai_issues = [i for i in ai_issues if i]
        except Exception as e:
            logger.warning(f"AI Text Validation Failed: {e}")
            ai_issues = [{
                "issue_type": "clarity",
                "issue": f"AI Validation API Failed to Validate Text: {str(e)}",
                "suggestion": "",
                "span": "",
                "severity": "error",
                "offset": 0,
                "length": 0,
                "confidence": 1.0,
                "source": "api_system_error",
            }]

    all_issues = _merge_issues(deterministic_issues, ai_issues)

    threshold = _SEVERITY_ORDER.get(min_issue_severity, 0)
    all_issues = [i for i in all_issues if _SEVERITY_ORDER.get(i.get("severity", "info"), 0) >= threshold]

    if segment_id:
        for issue in all_issues:
            issue["segment_id"] = segment_id

    return {
        "segment_id":      segment_id,
        "text":            text,
        "issues":          all_issues,
        "auto_fixed_text": _auto_fix(text) if auto_fix else None,
        "has_errors":      any(i["severity"] == "error"   for i in all_issues),
        "has_warnings":    any(i["severity"] == "warning" for i in all_issues),
    }


def validate_segments(
    segments: List[Dict],
    auto_fix: bool = False,
    only_with_issues: bool = True,
    enable_ai: bool = True,
    min_issue_severity: str = "info",
    document_context: Optional[Dict] = None,
) -> List[Dict]:
    """
    Validate a list of segment dicts. Completely bypasses static LLM fallbacks.
    Provides Error placeholders when AI rate-limiting crashes batches.
    """
    ai_results = {}
    consistency_results = _deterministic_consistency_issues(segments)

    if enable_ai:
        ai_results = _ai_validate_batch(
            segments,
            batch_size=20, # Higher batch size to prevent 429 Limit from groq
            document_context=document_context,
        )

    results = []
    for seg in segments:
        seg_id = seg.get("id")
        text = seg.get("text", "")

        if not text.strip() or seg.get("status") == "skip":
            continue

        deterministic_issues = _fast_guard(text)

        if enable_ai:
            raw_ai = ai_results.get(seg_id)
            if raw_ai is None: # None denotes API Failure, distinct from an empty list `[]` (clean)
                ai_issues = [{
                    "issue_type": "clarity",
                    "issue": "AI Validation Batch Failed (API Rate Limit / Timeout). Validation skipped.",
                    "suggestion": "",
                    "span": None,
                    "severity": "error",
                    "offset": None,
                    "length": None,
                    "confidence": 1.0,
                    "source": "api_system_error",
                }]
            else:
                ai_issues = raw_ai
        else:
            ai_issues = []

        all_issues = _merge_issues(deterministic_issues, ai_issues)
        all_issues.extend(consistency_results.get(seg_id, []))

        threshold = _SEVERITY_ORDER.get(min_issue_severity, 0)
        all_issues = [i for i in all_issues if _SEVERITY_ORDER.get(i.get("severity", "info"), 0) >= threshold]

        if seg_id:
            for issue in all_issues:
                issue["segment_id"] = seg_id

        result = {
            "segment_id":      seg_id,
            "text":            text,
            "issues":          all_issues,
            "auto_fixed_text": _auto_fix(text) if auto_fix else None,
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
    """Run AI validation on specified segments and auto-apply the suggestions."""
    target_ids = set(segment_ids) if segment_ids else None

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
        batch_size=20,
        document_context=document_context,
    )

    fixes = []
    seg_index = {s["id"]: s for s in segments if "id" in s}

    for seg in target_segments:
        sid = seg.get("id")
        original_text = seg.get("text", "")
        issues = ai_results.get(sid)

        # None means failure, [] means clean. Skip both.
        if not issues: 
            continue

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

            if issue.get("span") and span != issue["span"]:
                continue

            fixed_text = fixed_text[:start] + issue["suggestion"] + fixed_text[end:]
            applied.append(issue)

        if applied and fixed_text != original_text:
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
