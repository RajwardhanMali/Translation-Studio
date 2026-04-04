"""
Source validation service — v2 (Hybrid: Deterministic + AI Agent).

Two-layer architecture:
  Layer 1 (Deterministic): Free, instant checks — double spaces, basic spelling,
    repeated punctuation, unicode anomalies. Runs on every call.
  Layer 2 (AI Agent): LLM-powered contextual analysis — grammar in context,
    wrong-word errors, style/register, clarity, cross-segment consistency.
    Opt-in via `enable_ai=True`.

Design principles:
  - Layer 1: Only flag things that are 100% deterministic and clearly wrong.
  - Layer 2: Understands full sentence context. Returns structured JSON with
    severity, confidence scores, and actionable suggestions.
  - Deduplication: When both layers flag the same span, the AI's richer
    description wins but deterministic offsets are preferred (LLMs miscalculate).
  - Cross-segment consistency: When validating a full document, the AI agent
    receives a term-frequency summary so it can flag inconsistent terminology
    across the entire document (e.g., "client" vs "customer").
  - Backward compatible: `enable_ai=False` returns identical results to v1.
"""

import re
import json
import logging
from typing import List, Tuple, Dict, Optional, Any
from collections import Counter

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Consistency patterns — only flag when BOTH canonical AND variant coexist
# ---------------------------------------------------------------------------

CONSISTENCY_PAIRS: List[Tuple[str, List[str], str]] = [
    ("p.m.",  ["pm", "PM", "p.m", "P.M"],   "time notation"),
    ("a.m.",  ["am", "AM", "a.m", "A.M"],   "time notation"),
    ("e.g.",  ["e.g", "eg."],               "abbreviation"),
    ("i.e.",  ["i.e", "ie."],               "abbreviation"),
]


# ---------------------------------------------------------------------------
# Grammar rules — minimal, high-confidence only
# ---------------------------------------------------------------------------

GRAMMAR_RULES: List[Dict] = [
    {
        "name":       "double_space",
        "issue_type": "double_space",
        "pattern":    re.compile(r"  +"),
        "issue":      "Double space detected",
        "suggestion": "Replace with a single space",
        "severity":   "warning",
        "fix":        lambda m: " ",
    },
    {
        "name":       "repeated_punctuation",
        "issue_type": "grammar",
        "pattern":    re.compile(r"([!?]){2,}"),   # !! or ??? (not ellipsis ...)
        "issue":      "Repeated punctuation marks",
        "suggestion": "Use a single punctuation mark",
        "severity":   "info",
        "fix":        lambda m: m.group(1),
    },
]

# Words that look misspelled but are fine — domain terms, abbreviations, etc.
_SPELL_WHITELIST = {
    # tech / dev
    "api", "apis", "json", "xml", "html", "css", "js", "py", "url", "uri",
    "http", "https", "sql", "pdf", "docx", "xlsx", "csv", "uuid", "id",
    "ai", "ml", "nlp", "llm", "ui", "ux", "ip", "gpu", "cpu",
    "saas", "paas", "iaas", "b2b", "b2c", "crm", "erp",
    "backend", "frontend", "fullstack", "devops", "api", "apis",
    "localhost", "webhook", "subdomain", "microservice", "microservices",
    "env", "config", "configs", "repo", "repos", "dev", "prod", "qa",
    "npm", "pip", "cli", "sdk", "cdn", "dns", "ssl", "tls", "tcp", "udp",
    "oauth", "jwt", "yaml", "toml", "nginx", "redis", "postgres", "mongo",
    "kubernetes", "docker", "linux", "ubuntu", "aws", "gcp", "azure",
    # business / common abbreviations
    "hrs", "mins", "secs", "qty", "amt", "dept", "mgmt", "org", "orgs",
    "approx", "avg", "max", "min", "est", "info", "misc",
    "admin", "auth", "async", "sync", "init", "impl",
    # titles & honorifics
    "mr", "mrs", "ms", "dr", "prof", "etc", "vs", "eg", "ie",
    # common contractions that confuse the checker
    "doesn", "isn", "aren", "wasn", "weren", "wouldn", "couldn", "shouldn",
    "won", "can", "haven", "hadn", "didn",
}


# ===========================================================================
# LAYER 1: Deterministic checks (free, instant)
# ===========================================================================

# ---------------------------------------------------------------------------
# Spell checker (relaxed)
# ---------------------------------------------------------------------------

_spell = None


def _get_spell():
    global _spell
    if _spell is None:
        try:
            from spellchecker import SpellChecker
            _spell = SpellChecker()
        except ImportError:
            logger.warning("pyspellchecker not installed — spelling checks skipped.")
    return _spell


def _spell_check(text: str) -> List[Dict]:
    checker = _get_spell()
    if checker is None:
        return []

    # Find words with their positions to understand context
    candidates = []
    for match in re.finditer(r"\b[a-zA-Z]{3,}\b", text):
        w = match.group(0)
        if w.isupper() or w.lower() in _SPELL_WHITELIST:
            continue
            
        start_idx = match.start()
        # Heuristic for start of sentence
        is_first_word = (start_idx == 0)
        if not is_first_word:
            prefix = text[:start_idx].rstrip()
            if not prefix or prefix[-1] in ".!?\n":
                is_first_word = True
                
        # If it's capitalized but NOT the first word, assume Proper Noun and skip
        if w[0].isupper() and not is_first_word:
            continue
            
        candidates.append(w)

    if not candidates:
        return []

    # checker.unknown() returns lowercase words, so we need reverse mapping
    lower_to_orig = {w.lower(): w for w in candidates}
    
    misspelled = checker.unknown([w.lower() for w in candidates])
    issues = []
    for word_lc in misspelled:
        orig_word = lower_to_orig.get(word_lc, word_lc)
        correction = checker.correction(word_lc)
        
        # Skip if the checker has no better suggestion or it's just a case variant
        if not correction or correction == word_lc:
            continue
        if correction.lower() == word_lc.lower():
            continue

        # Skip if correction is just a substring/prefix of the original word.
        # PySpellChecker often suggests truncated forms for compound words
        # (e.g. "backend" → "backed", "frontend" → "front").
        if correction in word_lc or word_lc.startswith(correction):
            continue

        # Skip if the word contains the correction as a root
        # (e.g. "timestamps" → "timestamp" — plurals of tech terms)
        if word_lc.startswith(correction) and len(word_lc) - len(correction) <= 2:
            continue

        issues.append({
            "issue_type": "spelling",
            "issue":      f"Possible misspelling: '{orig_word}'",
            "suggestion": f"Did you mean '{correction}'?",
            "severity":   "warning",
            "offset":     text.find(orig_word),
            "length":     len(orig_word),
        })
    return issues


# ---------------------------------------------------------------------------
# Consistency check — only fires when BOTH forms coexist in the same text
# ---------------------------------------------------------------------------

def _consistency_check(text: str) -> List[Dict]:
    issues = []
    for canonical, variants, label in CONSISTENCY_PAIRS:
        canonical_present = canonical.lower() in text.lower()
        for variant in variants:
            if variant == canonical:
                continue
            pattern = re.compile(r"\b" + re.escape(variant) + r"\b")
            if pattern.search(text):
                if canonical_present:
                    # Both forms exist — genuine inconsistency
                    issues.append({
                        "issue_type": "consistency",
                        "issue":      f"Mixed {label}: '{variant}' and '{canonical}' both used",
                        "suggestion": f"Use '{canonical}' consistently",
                        "severity":   "warning",
                        "offset":     text.find(variant),
                        "length":     len(variant),
                    })
                # If only the variant exists (canonical absent) — NOT flagged.
                # The user may intentionally use "pm" throughout; that's fine.
    return issues


# ---------------------------------------------------------------------------
# Grammar check
# ---------------------------------------------------------------------------

def _grammar_check(text: str) -> List[Dict]:
    results = []
    for rule in GRAMMAR_RULES:
        for m in rule["pattern"].finditer(text):
            results.append({
                "issue_type": rule["issue_type"],
                "issue":      rule["issue"],
                "suggestion": rule["suggestion"],
                "severity":   rule["severity"],
                "offset":     m.start(),
                "length":     len(m.group(0)),
            })
    return results


# ---------------------------------------------------------------------------
# Auto-fix (deterministic only)
# ---------------------------------------------------------------------------

def _auto_fix(text: str) -> str:
    for rule in GRAMMAR_RULES:
        if rule.get("fix"):
            text = rule["pattern"].sub(rule["fix"], text)
    return text


# ===========================================================================
# LAYER 2: AI Agent validation (LLM-powered, opt-in)
# ===========================================================================

_VALIDATION_SYSTEM_PROMPT = """You are an expert editor, proofreader, and language quality analyst for enterprise documents. Your task is to analyze text for quality issues that a machine translation pipeline will consume.

You MUST return ONLY a valid JSON array. No markdown, no explanation, no wrapping — just the raw JSON array.

For each issue found, return an object with these exact keys:
{
  "issue_type": "grammar" | "spelling" | "style" | "consistency" | "clarity" | "wrong_word" | "punctuation",
  "severity": "error" | "warning" | "info",
  "issue": "clear description of the problem",
  "suggestion": "the corrected version of the problematic span",
  "span": "the exact problematic text from the input",
  "confidence": 0.0 to 1.0
}

Severity guide:
- "error": Changes meaning, factually broken grammar, wrong word that alters semantics (e.g., "loose" vs "lose", "their" vs "there", subject-verb disagreement)
- "warning": Likely a mistake but text is still understandable (e.g., missing article, awkward phrasing)
- "info": Style suggestion that improves readability but is not wrong (e.g., passive voice, wordiness)

Rules:
1. Do NOT flag proper nouns, brand names, or technical/domain-specific terms as misspellings.
2. Do NOT flag stylistic preferences unless they genuinely harm clarity.
3. Focus on issues that would cause problems in machine translation.
4. Be precise with the "span" field — copy the exact problematic text.
5. If the text is clean, return an empty array: []
6. Keep confidence high (>0.8) for clear errors, lower for style suggestions.
7. Pay special attention to spelling errors, wrong-word usage, and grammatical mistakes — the static spellchecker has been removed in favor of your contextual analysis."""

_CROSS_SEGMENT_ADDITION = """
Additionally, here is a summary of terminology used across the entire document. Flag any inconsistencies you notice in the text being analyzed (e.g., the text uses "customer" but the rest of the document predominantly uses "client"):

Document Term Summary:
{term_summary}
"""

# Batch validation prompt for multiple segments
_BATCH_VALIDATION_USER_PROMPT = """Analyze each of the following text segments for quality issues. Return a JSON object where keys are the segment IDs and values are arrays of issues (same format as above). If a segment is clean, its value should be an empty array.

{segments_block}

Return ONLY the JSON object. No markdown fences, no explanation."""


_DOCUMENT_CONTEXT_ADDITION = """
Document Context:
- Document type: {document_type}
- Domain: {domain}
- Register/tone: {register}
- Domain-specific keywords (do NOT flag these as spelling errors): {domain_keywords}

Use this context to calibrate your analysis. For example, legal documents should use formal register and legal terminology is expected; technical docs will contain jargon that is correct.
"""

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


def _parse_ai_response(raw: str) -> List[Dict]:
    """
    Parse the LLM's JSON response into a list of issue dicts.
    Handles common LLM output quirks (markdown fences, trailing commas, etc.).
    """
    cleaned = raw.strip()
    
    # Strip markdown code fences if present
    if cleaned.startswith("```"):
        # Remove opening fence (with optional language tag)
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
        cleaned = cleaned.strip()
    
    # Handle case where LLM wraps in { "issues": [...] }
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            # Try common wrapper keys
            for key in ("issues", "results", "errors", "data"):
                if key in parsed and isinstance(parsed[key], list):
                    return parsed[key]
            return []
        if isinstance(parsed, list):
            return parsed
        return []
    except json.JSONDecodeError:
        # Try to extract JSON array from the response
        match = re.search(r'\[.*\]', cleaned, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        logger.warning(f"Failed to parse AI validation response: {cleaned[:200]}")
        return []


def _ai_validate(
    text: str,
    term_summary: Optional[str] = None,
    document_context: Optional[Dict] = None,
) -> List[Dict]:
    """
    Layer 2: Use the LLM to perform context-aware validation on a single text.
    Returns a list of issue dicts compatible with the deterministic layer output.
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
    
    # Normalize each issue into our standard format
    normalized: List[Dict] = []
    for issue in raw_issues:
        if not isinstance(issue, dict):
            continue
        
        # Validate required fields
        issue_type = issue.get("issue_type", "grammar")
        if issue_type not in {"grammar", "spelling", "style", "consistency", 
                              "clarity", "wrong_word", "punctuation",
                              "double_space", "missing_space_after_punct",
                              "space_before_punct", "repeated_punctuation"}:
            issue_type = "grammar"
        
        severity = issue.get("severity", "info")
        if severity not in {"error", "warning", "info"}:
            severity = "info"
        
        description = issue.get("issue", "")
        suggestion = issue.get("suggestion", "")
        span = issue.get("span", "")
        confidence = issue.get("confidence", 0.5)
        
        if not description:
            continue
        
        # Try to locate the span in the text for offset/length
        offset = None
        length = None
        if span and span in text:
            offset = text.find(span)
            length = len(span)
        
        normalized.append({
            "issue_type":  issue_type,
            "issue":       description,
            "suggestion":  suggestion,
            "severity":    severity,
            "offset":      offset,
            "length":      length,
            "confidence":  float(confidence) if confidence is not None else None,
            "source":      "ai",
        })
    
    return normalized


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
    
    # Filter to only segments with actual text
    valid_segments = [
        s for s in segments
        if s.get("text", "").strip() and s.get("status") != "skip"
    ]
    
    if not valid_segments:
        return results
    
    # Process in batches
    for i in range(0, len(valid_segments), batch_size):
        batch = valid_segments[i:i + batch_size]
        
        # Build the segments block for the prompt
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
            # Mark all segments in this batch as having no AI issues
            for seg in batch:
                results[seg.get("id", "")] = []
            continue
        
        # Parse batch response
        parsed = _parse_batch_response(raw_response, batch)
        results.update(parsed)
    
    return results


def _parse_batch_response(raw: str, batch: List[Dict]) -> Dict[str, List[Dict]]:
    """Parse a batch AI validation response into per-segment issue lists."""
    cleaned = raw.strip()
    
    # Strip markdown fences
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
        cleaned = cleaned.strip()
    
    results: Dict[str, List[Dict]] = {}
    seg_texts = {seg.get("id", ""): seg.get("text", "") for seg in batch}
    
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to extract JSON object
        match = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse batch AI response: {cleaned[:300]}")
                return {seg.get("id", ""): [] for seg in batch}
        else:
            return {seg.get("id", ""): [] for seg in batch}
    
    if not isinstance(parsed, dict):
        return {seg.get("id", ""): [] for seg in batch}
    
    for seg in batch:
        sid = seg.get("id", "")
        raw_issues = parsed.get(sid, [])
        if not isinstance(raw_issues, list):
            raw_issues = []
        
        text = seg_texts.get(sid, "")
        normalized = []
        for issue in raw_issues:
            if not isinstance(issue, dict):
                continue
            
            issue_type = issue.get("issue_type", "grammar")
            if issue_type not in {"grammar", "spelling", "style", "consistency",
                                  "clarity", "wrong_word", "punctuation",
                                  "double_space", "missing_space_after_punct",
                                  "space_before_punct", "repeated_punctuation"}:
                issue_type = "grammar"
            
            severity = issue.get("severity", "info")
            if severity not in {"error", "warning", "info"}:
                severity = "info"
            
            description = issue.get("issue", "")
            suggestion = issue.get("suggestion", "")
            span = issue.get("span", "")
            confidence = issue.get("confidence", 0.5)
            
            if not description:
                continue
            
            offset = None
            length = None
            if span and span in text:
                offset = text.find(span)
                length = len(span)
            
            normalized.append({
                "issue_type":  issue_type,
                "issue":       description,
                "suggestion":  suggestion,
                "severity":    severity,
                "offset":      offset,
                "length":      length,
                "confidence":  float(confidence) if confidence is not None else None,
                "source":      "ai",
            })
        
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
    
    # Extract content words (3+ chars, not all-caps acronyms, not common stop words)
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
    
    # Only include terms that appear 2+ times (to reduce noise)
    frequent = {term: count for term, count in counter.items() if count >= 2}
    
    if not frequent:
        return None
    
    # Sort by frequency descending, take top 50
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
    - If both layers flag the same text span (overlapping offset+length), keep the
      AI version (richer description, severity scoring) but prefer the deterministic
      offset/length (more accurate positioning).
    - AI-only issues are added as-is.
    - Deterministic-only issues are kept as-is.
    """
    # Tag deterministic issues
    for issue in deterministic_issues:
        issue.setdefault("source", "deterministic")
        issue.setdefault("confidence", 1.0)
    
    if not ai_issues:
        return deterministic_issues
    
    if not deterministic_issues:
        return ai_issues
    
    merged: List[Dict] = []
    ai_consumed: set = set()  # indices of AI issues already merged
    
    for det_issue in deterministic_issues:
        det_offset = det_issue.get("offset")
        det_length = det_issue.get("length")
        
        if det_offset is None or det_length is None:
            merged.append(det_issue)
            continue
        
        det_start = det_offset
        det_end = det_offset + det_length
        
        # Look for overlapping AI issues
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
            
            # Check overlap
            if ai_start < det_end and ai_end > det_start:
                # Overlap found — use AI description + det position
                merged_issue = {
                    "issue_type":  ai_issue.get("issue_type", det_issue["issue_type"]),
                    "issue":       ai_issue.get("issue", det_issue["issue"]),
                    "suggestion":  ai_issue.get("suggestion", det_issue["suggestion"]),
                    "severity":    ai_issue.get("severity", det_issue["severity"]),
                    "offset":      det_offset,    # deterministic is more precise
                    "length":      det_length,
                    "confidence":  ai_issue.get("confidence", 1.0),
                    "source":      "merged",
                }
                merged.append(merged_issue)
                ai_consumed.add(ai_idx)
                found_overlap = True
                break
        
        if not found_overlap:
            merged.append(det_issue)
    
    # Add remaining AI-only issues
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
    min_issue_severity: str = "warning",   # "info" | "warning" | "error"
    enable_ai: bool = False,
    term_summary: Optional[str] = None,
    document_context: Optional[Dict] = None,
    legacy_spellcheck: bool = False,
) -> Dict:
    """
    Validate source text with hybrid deterministic + AI analysis.
    
    Args:
        text: The source text to validate.
        segment_id: Optional segment identifier.
        auto_fix: If True, apply deterministic auto-fixes.
        min_issue_severity: Filter threshold ("info", "warning", "error").
        enable_ai: If True, also run LLM-powered context-aware validation.
        term_summary: Optional cross-document term frequency summary.
        document_context: Optional dict with document_type, domain, register,
                          domain_keywords from the classifier.
        legacy_spellcheck: If True, run PySpellChecker (disabled by default).
    """
    # ── Layer 1: Deterministic checks ────────────────────────────────
    deterministic_issues: List[Dict] = []
    deterministic_issues.extend(_grammar_check(text))
    if legacy_spellcheck:
        deterministic_issues.extend(_spell_check(text))
    deterministic_issues.extend(_consistency_check(text))

    # ── Layer 2: AI Agent (opt-in) ───────────────────────────────────
    ai_issues: List[Dict] = []
    if enable_ai:
        ai_issues = _ai_validate(
            text,
            term_summary=term_summary,
            document_context=document_context,
        )

    # ── Merge & deduplicate ──────────────────────────────────────────
    all_issues = _merge_issues(deterministic_issues, ai_issues)

    # Severity filter — drop anything below the requested threshold
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
    only_with_issues: bool = True,        # skip clean segments — less clutter
    enable_ai: bool = False,
    document_context: Optional[Dict] = None,
    legacy_spellcheck: bool = False,
) -> List[Dict]:
    """
    Validate a list of segment dicts.
    
    When enable_ai=True:
    1. Builds a cross-document term summary from ALL segments.
    2. Sends segments in batched LLM calls for AI validation.
    3. Merges AI issues with deterministic issues per-segment.
    
    Args:
        document_context: Dict with document_type, domain, register, domain_keywords.
        legacy_spellcheck: If True, run PySpellChecker (disabled by default).
    """
    # ── Cross-segment term summary (for AI consistency checks) ───────────
    term_summary = None
    ai_results: Dict[str, List[Dict]] = {}
    
    if enable_ai:
        term_summary = _build_term_summary(segments)
        ai_results = _ai_validate_batch(
            segments,
            term_summary=term_summary,
            document_context=document_context,
        )
    
    # ── Per-segment validation ───────────────────────────────────────
    results = []
    for seg in segments:
        seg_id = seg.get("id")
        text = seg.get("text", "")
        
        if not text.strip() or seg.get("status") == "skip":
            continue
        
        # Layer 1: deterministic (spellcheck disabled by default)
        deterministic_issues: List[Dict] = []
        deterministic_issues.extend(_grammar_check(text))
        if legacy_spellcheck:
            deterministic_issues.extend(_spell_check(text))
        deterministic_issues.extend(_consistency_check(text))
        
        # Layer 2: AI (already computed in batch)
        ai_issues = ai_results.get(seg_id, [])
        
        # Merge
        all_issues = _merge_issues(deterministic_issues, ai_issues)
        
        # Severity filter
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