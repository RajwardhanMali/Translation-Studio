"""
Glossary engine.
Loads glossary from JSON, injects terms into LLM prompts,
and post-processes translations to enforce glossary constraints.

v2 changes:
  - Domain-scoped filtering: when document domain is known, only matching
    glossary terms (or universal terms with no domain) are applied.
  - Word-boundary matching: fixes the substring match bug where "data"
    was matching inside "database". Now uses regex word boundaries.
"""

import re
import logging
from typing import List, Dict, Optional, Tuple

from app.utils.file_handler import load_glossary, save_glossary

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Load / save
# ---------------------------------------------------------------------------

def get_glossary() -> Dict:
    """Return the current glossary dict."""
    return load_glossary()


def add_term(term: Dict) -> Dict:
    """
    Add a new term to the glossary.
    Replaces if source+language already exists.
    """
    glossary = load_glossary()
    terms    = glossary.get("terms", [])

    # Check for duplicate
    for i, existing in enumerate(terms):
        if (
            existing["source"].lower() == term["source"].lower()
            and existing.get("language", "fr") == term.get("language", "fr")
        ):
            terms[i] = term   # update in-place
            logger.info(f"Updated glossary term: '{term['source']}'")
            glossary["terms"] = terms
            save_glossary(glossary)
            return glossary

    terms.append(term)
    glossary["terms"] = terms
    save_glossary(glossary)
    logger.info(f"Added glossary term: '{term['source']}'")
    return glossary


# ---------------------------------------------------------------------------
# Prompt injection
# ---------------------------------------------------------------------------

def _term_matches_source(term_source: str, source_text: str) -> bool:
    """
    Check if a glossary term's source appears in the text using word-boundary
    matching. This prevents "data" from matching inside "database".
    """
    pattern = re.compile(r"\b" + re.escape(term_source) + r"\b", re.IGNORECASE)
    return bool(pattern.search(source_text))


def _filter_terms_by_domain(
    terms: List[Dict],
    target_language: str,
    document_domain: Optional[str] = None,
) -> List[Dict]:
    """
    Filter glossary terms by language and optionally by domain.
    
    Rules:
    - Terms with matching language are always considered.
    - If document_domain is set:
      - Terms with matching domain are included.
      - Terms with no domain (universal) are included.
      - Terms with a DIFFERENT domain are excluded.
    - If document_domain is None, all language-matching terms are included.
    """
    filtered = []
    for t in terms:
        if t.get("language", "fr") != target_language:
            continue
        
        term_domain = t.get("domain")
        
        if document_domain and term_domain:
            # Both document and term have domains — must match
            if term_domain.lower() != document_domain.lower():
                continue
        
        # Either no domain filter, or domains match, or term is universal
        filtered.append(t)
    
    return filtered


def build_glossary_prompt_fragment(
    source_text: str,
    target_language: str,
    document_domain: Optional[str] = None,
) -> str:
    """
    Build a glossary fragment to inject into the LLM system prompt.
    Only includes terms whose source appears in the source_text (word-boundary match).
    Optionally filters by document domain.
    """
    glossary = get_glossary()
    all_terms = glossary.get("terms", [])
    
    # Filter by language and domain
    domain_filtered = _filter_terms_by_domain(all_terms, target_language, document_domain)
    
    # Filter by presence in source text (word-boundary match)
    relevant_terms = [
        t for t in domain_filtered
        if _term_matches_source(t["source"], source_text)
    ]

    if not relevant_terms:
        return ""

    lines = ["Mandatory terminology (use these exact translations):"]
    for t in relevant_terms:
        note = f" ({t['notes']})" if t.get("notes") else ""
        domain_tag = f" [{t['domain']}]" if t.get("domain") else ""
        lines.append(f"  • {t['source']} → {t['target']}{domain_tag}{note}")

    return "\n".join(lines)


def get_style_rules() -> List[str]:
    """Return current style rules from glossary file."""
    return get_glossary().get("style_rules", [])


# ---------------------------------------------------------------------------
# Post-processing: enforce glossary in translated text
# ---------------------------------------------------------------------------

def enforce_glossary(
    translated_text: str,
    source_text: str,
    target_language: str,
    document_domain: Optional[str] = None,
) -> Tuple[str, List[Dict]]:
    """
    Detect glossary violations in a translated text and auto-correct them.
    Uses word-boundary matching to prevent substring false positives.
    Optionally filters by document domain.

    Returns:
        (corrected_text, list_of_violations)
    """
    glossary = get_glossary()
    all_terms = glossary.get("terms", [])
    
    # Filter by language and domain
    terms = _filter_terms_by_domain(all_terms, target_language, document_domain)
    
    violations: List[Dict] = []
    corrected = translated_text

    for term in terms:
        source = term["source"]
        target = term["target"]
        
        # Only process if source term appears in original source (word-boundary)
        if not _term_matches_source(source, source_text):
            continue

        # Check if target translation is present (word-boundary); if not — flag it
        target_pattern = re.compile(r"\b" + re.escape(target) + r"\b", re.IGNORECASE)
        if not target_pattern.search(corrected):
            violations.append({
                "source_term":  source,
                "expected":     target,
                "severity":     "error",
                "note":         f"Glossary term '{source}' not translated as '{target}'",
            })
            # Attempt word-boundary substitution for the untranslated source word
            corrected = re.sub(
                r"\b" + re.escape(source) + r"\b",
                target,
                corrected,
                flags=re.IGNORECASE,
            )
            logger.debug(f"Glossary enforcement: '{source}' → '{target}'")

    return corrected, violations
