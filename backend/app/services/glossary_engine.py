"""
Glossary engine.
Loads glossary from JSON, injects terms into LLM prompts,
and post-processes translations to enforce glossary constraints.
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

def build_glossary_prompt_fragment(
    source_text: str, target_language: str
) -> str:
    """
    Build a glossary fragment to inject into the LLM system prompt.
    Only includes terms whose source appears in the source_text.
    """
    glossary = get_glossary()
    relevant_terms = [
        t for t in glossary.get("terms", [])
        if (
            t.get("language", "fr") == target_language
            and t["source"].lower() in source_text.lower()
        )
    ]

    if not relevant_terms:
        return ""

    lines = ["Mandatory terminology (use these exact translations):"]
    for t in relevant_terms:
        note = f" ({t['notes']})" if t.get("notes") else ""
        lines.append(f"  • {t['source']} → {t['target']}{note}")

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
) -> Tuple[str, List[Dict]]:
    """
    Detect glossary violations in a translated text and auto-correct them.

    Returns:
        (corrected_text, list_of_violations)
    """
    glossary = get_glossary()
    violations: List[Dict] = []
    corrected = translated_text

    for term in glossary.get("terms", []):
        if term.get("language", "fr") != target_language:
            continue
        # Only process if source term appears in original source
        if term["source"].lower() not in source_text.lower():
            continue

        target = term["target"]
        source = term["source"]

        # Check if target translation is present; if not — flag it
        if target.lower() not in corrected.lower():
            violations.append({
                "source_term":  source,
                "expected":     target,
                "severity":     "error",
                "note":         f"Glossary term '{source}' not translated as '{target}'",
            })
            # Attempt naive substitution: look for the source word (untranslated)
            corrected = re.sub(
                r"\b" + re.escape(source) + r"\b",
                target,
                corrected,
                flags=re.IGNORECASE,
            )
            logger.debug(f"Glossary enforcement: '{source}' → '{target}'")

    return corrected, violations
