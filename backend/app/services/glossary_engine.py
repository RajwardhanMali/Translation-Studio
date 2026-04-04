"""
Glossary engine.
Loads glossary from Postgres, injects terms into LLM prompts,
and post-processes translations to enforce glossary constraints.
"""

import re
import logging
from typing import List, Dict, Optional, Tuple

from app.database import SessionLocal
from app.models.domain import GlossaryTerm

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Load / save
# ---------------------------------------------------------------------------

def get_glossary() -> Dict:
    """Return the current glossary dict from database."""
    db = SessionLocal()
    try:
        terms = db.query(GlossaryTerm).all()
        terms_list = []
        for t in terms:
            terms_list.append({
                "id": t.id,
                "source": t.source,
                "target": t.target,
                "language": t.language,
                "domain": t.domain,
                "notes": t.notes
            })
        return {
            "terms": terms_list,
            "style_rules": [] # Style rules are not modeled in Phase 1 DB migration
        }
    finally:
        db.close()


def add_term(term: Dict) -> Dict:
    """
    Add a new term to the glossary.
    Replaces if source+language already exists.
    """
    db = SessionLocal()
    try:
        existing = db.query(GlossaryTerm).filter(
            GlossaryTerm.source == term["source"],
            GlossaryTerm.language == term.get("language", "fr")
        ).first()

        if existing:
            existing.target = term["target"]
            existing.domain = term.get("domain")
            existing.notes = term.get("notes")
            logger.info(f"Updated glossary term: '{term['source']}'")
        else:
            new_term = GlossaryTerm(
                source=term["source"],
                target=term["target"],
                language=term.get("language", "fr"),
                domain=term.get("domain"),
                notes=term.get("notes")
            )
            db.add(new_term)
            logger.info(f"Added glossary term: '{term['source']}'")

        db.commit()
    finally:
        db.close()
        
    return get_glossary()


# ---------------------------------------------------------------------------
# Prompt injection
# ---------------------------------------------------------------------------

def _term_matches_source(term_source: str, source_text: str) -> bool:
    pattern = re.compile(r"\b" + re.escape(term_source) + r"\b", re.IGNORECASE)
    return bool(pattern.search(source_text))


def _filter_terms_by_domain(
    terms: List[Dict],
    target_language: str,
    document_domain: Optional[str] = None,
) -> List[Dict]:
    filtered = []
    for t in terms:
        if t.get("language", "fr") != target_language:
            continue
        
        term_domain = t.get("domain")
        if document_domain and term_domain:
            if term_domain.lower() != document_domain.lower():
                continue
        
        filtered.append(t)
    
    return filtered


def build_glossary_prompt_fragment(
    source_text: str,
    target_language: str,
    document_domain: Optional[str] = None,
) -> str:
    glossary = get_glossary()
    all_terms = glossary.get("terms", [])
    
    domain_filtered = _filter_terms_by_domain(all_terms, target_language, document_domain)
    
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
    glossary = get_glossary()
    all_terms = glossary.get("terms", [])
    
    terms = _filter_terms_by_domain(all_terms, target_language, document_domain)
    
    violations: List[Dict] = []
    corrected = translated_text

    for term in terms:
        source = term["source"]
        target = term["target"]
        
        if not _term_matches_source(source, source_text):
            continue

        target_pattern = re.compile(r"\b" + re.escape(target) + r"\b", re.IGNORECASE)
        if not target_pattern.search(corrected):
            violations.append({
                "source_term":  source,
                "expected":     target,
                "severity":     "error",
                "note":         f"Glossary term '{source}' not translated as '{target}'",
            })
            corrected = re.sub(
                r"\b" + re.escape(source) + r"\b",
                target,
                corrected,
                flags=re.IGNORECASE,
            )
            logger.debug(f"Glossary enforcement: '{source}' → '{target}'")

    return corrected, violations
