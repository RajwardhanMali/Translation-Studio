"""
Source validation service.
Checks spelling, grammar patterns, and consistency issues in source text.

Design philosophy (relaxed for real-world use):
  - Only flag things that are clearly wrong, not stylistic preferences.
  - Spelling: skip short words (≤2 chars), proper-noun candidates, acronyms,
    numbers-adjacent tokens, and words the checker has no suggestion for.
  - Grammar: only double-spaces (genuine accident) and repeated punctuation.
  - Consistency: only flag when BOTH variants appear in the same text block,
    not just because one variant exists.
  - Punctuation spacing: downgraded to "info" and only fired when obvious.
"""

import re
import logging
from typing import List, Tuple, Dict, Optional

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
    "api", "apis", "json", "xml", "html", "css", "js", "py", "url", "uri",
    "http", "https", "sql", "pdf", "docx", "xlsx", "csv", "uuid", "id",
    "ai", "ml", "nlp", "llm", "ui", "ux", "ip", "gpu", "cpu",
    "saas", "paas", "iaas", "b2b", "b2c", "crm", "erp",
    "mr", "mrs", "ms", "dr", "prof", "etc", "vs", "eg", "ie",
    # common contractions that confuse the checker
    "doesn", "isn", "aren", "wasn", "weren", "wouldn", "couldn", "shouldn",
    "won", "can", "haven", "hadn", "didn",
}


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

    # Only check real words: 3+ chars, all alpha (no mixed alphanumeric like "GPT4")
    words = re.findall(r"\b[a-zA-Z]{3,}\b", text)

    # Filter: skip ALLCAPS acronyms, Title-Case proper-noun candidates, whitelist
    candidates = [
        w for w in words
        if not w.isupper()                        # skip ALL-CAPS
        and not w[0].isupper()                    # skip Proper Noun candidates
        and w.lower() not in _SPELL_WHITELIST
    ]

    if not candidates:
        return []

    misspelled = checker.unknown(candidates)
    issues = []
    for word in misspelled:
        correction = checker.correction(word)
        # Skip if the checker has no better suggestion (returns the word itself or None)
        if not correction or correction == word:
            continue
        # Skip if the "correction" is just a case variant
        if correction.lower() == word.lower():
            continue

        issues.append({
            "issue_type": "spelling",
            "issue":      f"Possible misspelling: '{word}'",
            "suggestion": f"Did you mean '{correction}'?",
            "severity":   "warning",    # downgraded from error — humans decide
            "offset":     text.find(word),
            "length":     len(word),
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
# Auto-fix
# ---------------------------------------------------------------------------

def _auto_fix(text: str) -> str:
    for rule in GRAMMAR_RULES:
        if rule.get("fix"):
            text = rule["pattern"].sub(rule["fix"], text)
    return text


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def validate_text(
    text: str,
    segment_id: Optional[str] = None,
    auto_fix: bool = False,
    min_issue_severity: str = "warning",   # "info" | "warning" | "error"
) -> Dict:
    """
    Validate source text. By default only surfaces warnings and errors,
    suppressing pure info-level noise.
    """
    all_issues: List[Dict] = []
    all_issues.extend(_grammar_check(text))
    all_issues.extend(_spell_check(text))
    all_issues.extend(_consistency_check(text))

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
) -> List[Dict]:
    """
    Validate a list of segment dicts.
    With only_with_issues=True (default), returns only segments that have
    at least one issue, keeping the response lean.
    """
    results = []
    for seg in segments:
        result = validate_text(
            text=seg.get("text", ""),
            segment_id=seg.get("id"),
            auto_fix=auto_fix,
        )
        if only_with_issues and not result["issues"]:
            continue
        results.append(result)
    return results