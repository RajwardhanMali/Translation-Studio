"""
Document classification service.

Classifies a document's type, domain, and register using a single LLM call
at upload time. The result is persisted in the document metadata and flows
downstream into validation (context-aware prompts) and glossary enforcement
(domain-scoped term filtering).

Cost: exactly 1 LLM call per document upload — negligible since uploads
are infrequent compared to translation calls.
"""

import json
import re
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# Soft enum of known document categories — the LLM is guided toward these
# but can use "other" for edge cases.
KNOWN_DOCUMENT_TYPES = [
    "legal_contract",
    "legal_agreement",
    "financial_report",
    "financial_statement",
    "medical_record",
    "healthcare",
    "technical_documentation",
    "software_engineering",
    "marketing_material",
    "academic_paper",
    "research",
    "correspondence",
    "internal_memo",
    "policy_document",
    "general",
]

_CLASSIFICATION_SYSTEM_PROMPT = """You are a document classification expert. Analyze the provided text sample and classify the document.

Return ONLY a valid JSON object with these exact keys:
{
  "document_type": "<one of: legal_contract, legal_agreement, financial_report, financial_statement, medical_record, healthcare, technical_documentation, software_engineering, marketing_material, academic_paper, research, correspondence, internal_memo, policy_document, general>",
  "confidence": <0.0 to 1.0>,
  "domain": "<broad domain: legal, financial, medical, technical, marketing, academic, government, general>",
  "register": "<formal, semi-formal, informal, technical>",
  "domain_keywords": ["<list of 5-15 domain-specific terms found in the text that should NOT be flagged as spelling errors>"]
}

Rules:
1. Choose the most specific document_type that fits.
2. If unsure, use "general" with lower confidence.
3. domain_keywords should contain specialized vocabulary from the text — technical jargon, industry terms, proper nouns, abbreviations specific to this domain.
4. Return ONLY the JSON object. No markdown, no explanation."""


def classify_document(text_sample: str) -> Dict:
    """
    Classify a document by analyzing a text sample (first ~2000 chars).

    Returns a dict with:
        - document_type: str (e.g., "legal_contract")
        - confidence: float (0.0-1.0)
        - domain: str (e.g., "legal")
        - register: str (e.g., "formal")
        - domain_keywords: List[str]

    Falls back to a safe default if the LLM call fails.
    """
    if not text_sample or not text_sample.strip():
        return _default_classification()

    # Truncate to ~2000 chars for cost efficiency
    sample = text_sample[:2000].strip()

    try:
        from app.services.llm_service import _call_llm
    except ImportError:
        logger.warning("LLM service not available — using default classification.")
        return _default_classification()

    user_prompt = f'Classify this document:\n"""\n{sample}\n"""'

    try:
        raw = _call_llm(_CLASSIFICATION_SYSTEM_PROMPT, user_prompt, max_tokens=512)
    except Exception as e:
        logger.warning(f"Document classification LLM call failed: {e}")
        return _default_classification()

    return _parse_classification(raw)


def _parse_classification(raw: str) -> Dict:
    """Parse the LLM's classification response with robust error handling."""
    cleaned = raw.strip()

    # Strip markdown fences if present
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?", "", cleaned)
        cleaned = re.sub(r"\n?```$", "", cleaned)
        cleaned = cleaned.strip()

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        # Try to extract JSON object from text
        match = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
            except json.JSONDecodeError:
                logger.warning(f"Failed to parse classification response: {cleaned[:200]}")
                return _default_classification()
        else:
            logger.warning(f"No JSON found in classification response: {cleaned[:200]}")
            return _default_classification()

    if not isinstance(parsed, dict):
        return _default_classification()

    # Validate and normalize
    doc_type = parsed.get("document_type", "general")
    if doc_type not in KNOWN_DOCUMENT_TYPES:
        doc_type = "general"

    domain = parsed.get("domain", "general")
    register = parsed.get("register", "formal")
    if register not in {"formal", "semi-formal", "informal", "technical"}:
        register = "formal"

    confidence = parsed.get("confidence", 0.5)
    try:
        confidence = float(confidence)
        confidence = max(0.0, min(1.0, confidence))
    except (TypeError, ValueError):
        confidence = 0.5

    keywords = parsed.get("domain_keywords", [])
    if not isinstance(keywords, list):
        keywords = []
    keywords = [str(k).lower().strip() for k in keywords if k]

    return {
        "document_type": doc_type,
        "confidence": confidence,
        "domain": domain,
        "register": register,
        "domain_keywords": keywords,
    }


def _default_classification() -> Dict:
    """Safe fallback when classification is unavailable."""
    return {
        "document_type": "general",
        "confidence": 0.0,
        "domain": "general",
        "register": "formal",
        "domain_keywords": [],
    }
