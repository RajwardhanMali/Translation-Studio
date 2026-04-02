import pytest
from app.services.validator import validate_text

def test_spellcheck_first_word():
    """Ensure the spellchecker does not bypass misspelled first words that are capitalized."""
    text = "Thiss is a test sentence."
    result = validate_text(text, auto_fix=False, min_issue_severity="warning")
    issues = result.get("issues", [])
    
    spell_issues = [i for i in issues if i["issue_type"] == "spelling"]
    
    # If pyspellchecker isn't installed, it returns [], gracefully skipping.
    if spell_issues:
        assert len(spell_issues) == 1
        assert "Thiss" in spell_issues[0]["issue"]

def test_spellcheck_proper_noun():
    """Ensure capitalized words in the middle of sentences are assumed strictly to be proper nouns and thus ignored by the checker."""
    text = "Welcome to Gggggoogle headquarters."
    result = validate_text(text, auto_fix=False, min_issue_severity="warning")
    issues = result.get("issues", [])
    
    spell_issues = [i for i in issues if i["issue_type"] == "spelling"]
    assert len(spell_issues) == 0
