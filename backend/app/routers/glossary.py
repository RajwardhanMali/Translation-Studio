"""
Glossary router.
GET  /glossary — retrieve all glossary terms and style rules
POST /glossary — add a new glossary term
"""

import logging
from fastapi import APIRouter, HTTPException

from app.models.schemas import GlossaryResponse, AddGlossaryTermRequest
from app.services.glossary_engine import get_glossary, add_term

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/glossary", tags=["glossary"])


@router.get("", response_model=GlossaryResponse)
async def get_glossary_endpoint():
    """Return the full glossary with all terms and style rules."""
    data = get_glossary()
    return GlossaryResponse(
        terms=data.get("terms", []),
        style_rules=data.get("style_rules", []),
    )


@router.post("", response_model=GlossaryResponse)
async def add_glossary_term(request: AddGlossaryTermRequest):
    """
    Add a new term to the glossary.
    If a term with the same source+language already exists, it will be updated.
    """
    try:
        updated_glossary = add_term(request.term.model_dump())
        return GlossaryResponse(
            terms=updated_glossary.get("terms", []),
            style_rules=updated_glossary.get("style_rules", []),
        )
    except Exception as e:
        logger.error(f"Failed to add glossary term: {e}")
        raise HTTPException(status_code=500, detail=str(e))
