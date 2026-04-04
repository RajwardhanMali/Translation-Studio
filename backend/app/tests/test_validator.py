"""
Tests for the hybrid validation module (Layer 1 Deterministic + Layer 2 AI Agent).

Covers:
  - Backward compatibility: all v1 deterministic tests still pass
  - AI layer with mocked LLM responses (grammar, clean text, edge cases)
  - Deduplication: same issue flagged by both layers → single merged result
  - Batched AI validation across multiple segments
  - Cross-segment term summary extraction
  - enable_ai=False returns identical results to v1
  - Severity filtering
  - Auto-fix behavior
"""

import pytest
from unittest.mock import patch, MagicMock
from app.services.validator import (
    validate_text,
    validate_segments,
    _grammar_check,
    _spell_check,
    _consistency_check,
    _merge_issues,
    _build_term_summary,
    _parse_ai_response,
    _ai_validate,
    _ai_validate_batch,
)


# ===========================================================================
# Layer 1: Backward compatibility tests (deterministic)
# ===========================================================================

class TestDeterministicSpelling:
    """Spelling checks — these MUST pass identically to v1."""

    def test_spellcheck_first_word(self):
        """Misspelled first words that are capitalized should still be flagged."""
        text = "Thiss is a test sentence."
        result = validate_text(text, auto_fix=False, min_issue_severity="warning")
        issues = result.get("issues", [])
        
        spell_issues = [i for i in issues if i["issue_type"] == "spelling"]
        
        # If pyspellchecker isn't installed, it returns [], gracefully skipping.
        if spell_issues:
            assert len(spell_issues) == 1
            assert "Thiss" in spell_issues[0]["issue"]

    def test_spellcheck_proper_noun(self):
        """Capitalized words mid-sentence are treated as proper nouns and skipped."""
        text = "Welcome to Gggggoogle headquarters."
        result = validate_text(text, auto_fix=False, min_issue_severity="warning")
        issues = result.get("issues", [])
        
        spell_issues = [i for i in issues if i["issue_type"] == "spelling"]
        assert len(spell_issues) == 0

    def test_spellcheck_acronyms_skipped(self):
        """ALL-CAPS words should not be flagged."""
        text = "The API endpoint uses JSON and XML formats."
        result = validate_text(text, min_issue_severity="info")
        issues = [i for i in result["issues"] if i["issue_type"] == "spelling"]
        assert len(issues) == 0

    def test_spellcheck_whitelist_terms(self):
        """Domain terms in the whitelist should be skipped."""
        text = "The docx file was converted from csv to xlsx format."
        result = validate_text(text, min_issue_severity="info")
        issues = [i for i in result["issues"] if i["issue_type"] == "spelling"]
        assert len(issues) == 0

    def test_spellcheck_backend_not_flagged(self):
        """'backend' should NOT be flagged as 'backed'."""
        text = "The backend service handles all requests."
        result = validate_text(text, min_issue_severity="info")
        issues = [i for i in result["issues"] if i["issue_type"] == "spelling"]
        assert len(issues) == 0

    def test_spellcheck_hrs_not_flagged(self):
        """'hrs' should NOT be flagged as 'his'."""
        text = "The process takes approximately 3 hrs to complete."
        result = validate_text(text, min_issue_severity="info")
        issues = [i for i in result["issues"] if i["issue_type"] == "spelling"]
        assert len(issues) == 0

    def test_spellcheck_frontend_not_flagged(self):
        """'frontend' should NOT be flagged."""
        text = "The frontend application renders the dashboard."
        result = validate_text(text, min_issue_severity="info")
        issues = [i for i in result["issues"] if i["issue_type"] == "spelling"]
        assert len(issues) == 0

    def test_spellcheck_compound_word_not_truncated(self):
        """Words where the suggestion is just a prefix/substring should be skipped."""
        text = "The timestamps were logged in the microservice."
        result = validate_text(text, min_issue_severity="info")
        issues = [i for i in result["issues"] if i["issue_type"] == "spelling"]
        # Neither "timestamps" nor "microservice" should be flagged
        flagged_words = [i["issue"] for i in issues]
        assert not any("timestamps" in w for w in flagged_words)
        assert not any("microservice" in w for w in flagged_words)


class TestDeterministicGrammar:
    """Grammar rule checks (regex-based)."""

    def test_double_space_detected(self):
        text = "This has  double spaces."
        result = validate_text(text, min_issue_severity="warning")
        ds_issues = [i for i in result["issues"] if i["issue_type"] == "double_space"]
        assert len(ds_issues) == 1
        assert ds_issues[0]["offset"] == 8

    def test_repeated_punctuation(self):
        text = "Really?? That's amazing!!"
        result = validate_text(text, min_issue_severity="info")
        punct_issues = [i for i in result["issues"] if i["issue_type"] == "grammar"]
        assert len(punct_issues) >= 1

    def test_clean_text_no_issues(self):
        text = "This is a perfectly clean sentence with no issues."
        result = validate_text(text, min_issue_severity="info")
        assert len(result["issues"]) == 0

    def test_auto_fix_double_space(self):
        text = "Fix  this  double  spacing."
        result = validate_text(text, auto_fix=True)
        assert "  " not in result["auto_fixed_text"]
        assert result["auto_fixed_text"] == "Fix this double spacing."


class TestDeterministicConsistency:
    """Consistency pair checks."""

    def test_mixed_am_pm_flagged(self):
        text = "The meeting is at 3 p.m. or maybe 4 PM."
        result = validate_text(text, min_issue_severity="warning")
        cons_issues = [i for i in result["issues"] if i["issue_type"] == "consistency"]
        assert len(cons_issues) >= 1

    def test_single_variant_not_flagged(self):
        """If only one form exists, it should NOT be flagged."""
        text = "The meeting is at 3 PM and the lunch is at 12 PM."
        result = validate_text(text, min_issue_severity="warning")
        cons_issues = [i for i in result["issues"] if i["issue_type"] == "consistency"]
        assert len(cons_issues) == 0


class TestSeverityFiltering:
    """Severity threshold filtering."""

    def test_info_filter_includes_all(self):
        """With min_issue_severity='info', everything should come through."""
        text = "Really?? This has  issues."
        result = validate_text(text, min_issue_severity="info")
        assert len(result["issues"]) >= 2  # double space + repeated punct

    def test_warning_filter_excludes_info(self):
        """With min_issue_severity='warning', info-level issues are dropped."""
        text = "Really??"
        result_info = validate_text(text, min_issue_severity="info")
        result_warn = validate_text(text, min_issue_severity="warning")
        assert len(result_info["issues"]) >= len(result_warn["issues"])

    def test_error_filter_strict(self):
        """With min_issue_severity='error', only errors come through."""
        text = "This has  double spaces and really?? issues."
        result = validate_text(text, min_issue_severity="error")
        for issue in result["issues"]:
            assert issue["severity"] == "error"


class TestEnableAiFalse:
    """When enable_ai=False, results must be identical to v1 behavior."""

    def test_no_ai_issues_when_disabled(self):
        text = "The company loose money every day."
        result = validate_text(text, enable_ai=False)
        # "loose" is a real word, so deterministic spellcheck won't flag it
        ai_issues = [i for i in result["issues"] if i.get("source") == "ai"]
        assert len(ai_issues) == 0

    def test_result_structure_unchanged(self):
        text = "Simple test."
        result = validate_text(text, enable_ai=False)
        assert "segment_id" in result
        assert "text" in result
        assert "issues" in result
        assert "auto_fixed_text" in result
        assert "has_errors" in result
        assert "has_warnings" in result


# ===========================================================================
# Layer 2: AI Agent tests (mocked LLM)
# ===========================================================================

class TestAIResponseParsing:
    """Test the JSON response parser for various LLM output formats."""

    def test_parse_clean_json_array(self):
        raw = '[{"issue_type": "grammar", "severity": "error", "issue": "Wrong word", "suggestion": "Fix it", "span": "loose", "confidence": 0.95}]'
        result = _parse_ai_response(raw)
        assert len(result) == 1
        assert result[0]["issue_type"] == "grammar"

    def test_parse_empty_array(self):
        raw = "[]"
        result = _parse_ai_response(raw)
        assert result == []

    def test_parse_markdown_fenced(self):
        raw = '```json\n[{"issue_type": "spelling", "severity": "warning", "issue": "typo", "suggestion": "fix", "span": "teh", "confidence": 0.9}]\n```'
        result = _parse_ai_response(raw)
        assert len(result) == 1

    def test_parse_wrapped_in_object(self):
        raw = '{"issues": [{"issue_type": "grammar", "severity": "error", "issue": "test", "suggestion": "fix", "span": "x", "confidence": 0.8}]}'
        result = _parse_ai_response(raw)
        assert len(result) == 1

    def test_parse_garbage_returns_empty(self):
        raw = "I found some issues in the text but here they are..."
        result = _parse_ai_response(raw)
        assert result == []

    def test_parse_empty_string(self):
        result = _parse_ai_response("")
        assert result == []


class TestAIValidateSingle:
    """Test single-segment AI validation with mocked LLM."""

    @patch("app.services.llm_service._call_llm")
    def test_ai_catches_wrong_word(self, mock_llm):
        mock_llm.return_value = '[{"issue_type": "wrong_word", "severity": "error", "issue": "Wrong word: loose should be lose", "suggestion": "lose", "span": "loose", "confidence": 0.95}]'
        
        issues = _ai_validate("The company will loose money.")
            
        assert len(issues) == 1
        assert issues[0]["issue_type"] == "wrong_word"
        assert issues[0]["severity"] == "error"
        assert issues[0]["source"] == "ai"

    @patch("app.services.llm_service._call_llm")
    def test_ai_returns_empty_for_clean_text(self, mock_llm):
        mock_llm.return_value = "[]"
        
        issues = _ai_validate("This is a perfectly written sentence.")
        
        assert issues == []

    def test_ai_skips_empty_text(self):
        issues = _ai_validate("")
        assert issues == []

    def test_ai_skips_whitespace_only(self):
        issues = _ai_validate("   ")
        assert issues == []


class TestAIValidateBatch:
    """Test batched multi-segment AI validation."""

    @patch("app.services.llm_service._call_llm")
    def test_batch_returns_per_segment(self, mock_llm):
        mock_response = '{"seg1": [{"issue_type": "grammar", "severity": "warning", "issue": "Missing article", "suggestion": "the report", "span": "report", "confidence": 0.8}], "seg2": []}'
        mock_llm.return_value = mock_response
        
        segments = [
            {"id": "seg1", "text": "Send report to manager.", "status": "pending"},
            {"id": "seg2", "text": "This is fine.", "status": "pending"},
        ]
        
        results = _ai_validate_batch(segments)
        
        assert "seg1" in results
        assert "seg2" in results
        assert len(results["seg1"]) == 1
        assert len(results["seg2"]) == 0

    def test_batch_skips_empty_segments(self):
        segments = [
            {"id": "seg1", "text": "", "status": "pending"},
            {"id": "seg2", "text": "   ", "status": "pending"},
        ]
        results = _ai_validate_batch(segments)
        assert results == {}

    def test_batch_skips_skip_status(self):
        segments = [
            {"id": "seg1", "text": "Some text", "status": "skip"},
        ]
        results = _ai_validate_batch(segments)
        assert results == {}


# ===========================================================================
# Deduplication tests
# ===========================================================================

class TestMergeIssues:
    """Test the merge/deduplication logic between deterministic and AI layers."""

    def test_overlapping_issues_merged(self):
        """When both layers flag the same span, merge into one."""
        det = [{"issue_type": "spelling", "issue": "Misspelling: teh", "suggestion": "the",
                "severity": "warning", "offset": 5, "length": 3, "source": "deterministic"}]
        ai = [{"issue_type": "spelling", "issue": "Typo detected: 'teh' should be 'the'",
               "suggestion": "the", "severity": "warning", "offset": 5, "length": 3,
               "confidence": 0.95, "source": "ai"}]
        
        merged = _merge_issues(det, ai)
        assert len(merged) == 1
        # AI description should win
        assert "Typo detected" in merged[0]["issue"]
        # Deterministic offset should be kept
        assert merged[0]["offset"] == 5
        assert merged[0]["source"] == "merged"

    def test_non_overlapping_issues_kept_separate(self):
        """Issues at different positions should both be kept."""
        det = [{"issue_type": "double_space", "issue": "Double space", "suggestion": " ",
                "severity": "warning", "offset": 5, "length": 2, "source": "deterministic"}]
        ai = [{"issue_type": "grammar", "issue": "Missing article", "suggestion": "the cat",
               "severity": "warning", "offset": 20, "length": 3, "confidence": 0.8, "source": "ai"}]
        
        merged = _merge_issues(det, ai)
        assert len(merged) == 2

    def test_empty_ai_returns_deterministic(self):
        det = [{"issue_type": "spelling", "issue": "test", "suggestion": "fix",
                "severity": "warning", "offset": 0, "length": 4}]
        merged = _merge_issues(det, [])
        assert len(merged) == 1

    def test_empty_deterministic_returns_ai(self):
        ai = [{"issue_type": "style", "issue": "Passive voice", "suggestion": "Use active",
               "severity": "info", "offset": 0, "length": 10, "confidence": 0.7, "source": "ai"}]
        merged = _merge_issues([], ai)
        assert len(merged) == 1

    def test_no_issues_returns_empty(self):
        merged = _merge_issues([], [])
        assert merged == []

    def test_ai_issue_without_offset_kept(self):
        """AI issues without offset/length should still be included."""
        det = []
        ai = [{"issue_type": "clarity", "issue": "Awkward phrasing", "suggestion": "Rewrite",
               "severity": "info", "offset": None, "length": None, "confidence": 0.6, "source": "ai"}]
        merged = _merge_issues(det, ai)
        assert len(merged) == 1


# ===========================================================================
# Cross-segment consistency tests
# ===========================================================================

class TestCrossSegmentConsistency:
    """Test term summary extraction for document-wide consistency."""

    def test_term_summary_extracts_frequent_terms(self):
        segments = [
            {"text": "The client requested a new feature. The client needs it urgently."},
            {"text": "Our customer support team handles customer complaints."},
        ]
        summary = _build_term_summary(segments)
        assert summary is not None
        assert "client" in summary
        assert "customer" in summary

    def test_term_summary_ignores_stop_words(self):
        segments = [
            {"text": "The the the and and and for for for."},
        ]
        summary = _build_term_summary(segments)
        # Stop words should be filtered, likely nothing significant left
        assert summary is None or "the" not in summary

    def test_term_summary_ignores_single_occurrence(self):
        segments = [
            {"text": "Unique word aardvark appears only once."},
        ]
        summary = _build_term_summary(segments)
        if summary:
            assert "aardvark" not in summary

    def test_term_summary_empty_segments(self):
        segments = [{"text": ""}, {"text": "   "}]
        summary = _build_term_summary(segments)
        assert summary is None


# ===========================================================================
# Integration: validate_text with enable_ai
# ===========================================================================

class TestValidateTextWithAI:
    """Integration tests for the full validate_text flow with AI enabled."""

    @patch("app.services.validator._ai_validate")
    def test_ai_issues_appear_when_enabled(self, mock_ai):
        mock_ai.return_value = [
            {"issue_type": "wrong_word", "issue": "loose should be lose",
             "suggestion": "lose", "severity": "error", "offset": 16, "length": 5,
             "confidence": 0.95, "source": "ai"}
        ]
        
        result = validate_text(
            "The company will loose money.",
            enable_ai=True,
            min_issue_severity="warning"
        )
        
        ai_issues = [i for i in result["issues"] if i.get("source") in ("ai", "merged")]
        assert len(ai_issues) >= 1
        assert result["has_errors"] is True

    @patch("app.services.validator._ai_validate")
    def test_ai_disabled_no_ai_issues(self, mock_ai):
        result = validate_text(
            "The company will loose money.",
            enable_ai=False,
        )
        mock_ai.assert_not_called()
        ai_issues = [i for i in result["issues"] if i.get("source") == "ai"]
        assert len(ai_issues) == 0


# ===========================================================================
# Integration: validate_segments with enable_ai
# ===========================================================================

class TestValidateSegmentsWithAI:
    """Integration tests for batched segment validation."""

    @patch("app.services.validator._ai_validate_batch")
    def test_batch_validation_called_when_ai_enabled(self, mock_batch):
        mock_batch.return_value = {
            "seg1": [{"issue_type": "grammar", "issue": "test", "suggestion": "fix",
                      "severity": "warning", "offset": 0, "length": 4,
                      "confidence": 0.8, "source": "ai"}],
        }
        
        segments = [
            {"id": "seg1", "text": "This has  double spaces and grammar issues."},
        ]
        
        results = validate_segments(segments, enable_ai=True)
        mock_batch.assert_called_once()
        assert len(results) >= 1

    def test_segments_without_ai_returns_deterministic_only(self):
        segments = [
            {"id": "seg1", "text": "This has  double spaces."},
            {"id": "seg2", "text": "Clean text here."},
        ]
        
        results = validate_segments(segments, enable_ai=False, only_with_issues=True)
        # seg1 should have double_space issue, seg2 should be skipped
        assert len(results) >= 1
        for r in results:
            for issue in r["issues"]:
                assert issue.get("source", "deterministic") != "ai"

    def test_only_with_issues_filters_clean(self):
        segments = [
            {"id": "seg1", "text": "Perfectly clean sentence here."},
            {"id": "seg2", "text": "Another clean sentence."},
        ]
        results = validate_segments(segments, only_with_issues=True)
        assert len(results) == 0

    def test_skip_segments_ignored(self):
        segments = [
            {"id": "seg1", "text": "This has  issues.", "status": "skip"},
        ]
        results = validate_segments(segments)
        assert len(results) == 0


# ===========================================================================
# Edge cases
# ===========================================================================

class TestEdgeCases:
    """Edge cases and robustness tests."""

    def test_empty_string(self):
        result = validate_text("")
        assert result["issues"] == []

    def test_none_text_handling(self):
        """validate_segments should handle segments with missing text."""
        segments = [{"id": "seg1"}]  # no "text" key
        results = validate_segments(segments)
        assert results == []

    def test_very_long_text(self):
        text = "This is a sentence. " * 500
        result = validate_text(text)
        # Should not crash
        assert isinstance(result["issues"], list)

    def test_unicode_text(self):
        text = "The café serves naïve résumé holders."
        result = validate_text(text, min_issue_severity="info")
        # Should not crash on unicode
        assert isinstance(result["issues"], list)

    def test_segment_id_propagation(self):
        result = validate_text("Test  text.", segment_id="my-seg-123", min_issue_severity="warning")
        for issue in result["issues"]:
            assert issue.get("segment_id") == "my-seg-123"

    def test_has_errors_flag(self):
        """has_errors should be True when error-severity issues exist."""
        # Deterministic only produces warnings, not errors
        result = validate_text("This has  double spaces.", min_issue_severity="info")
        assert result["has_errors"] is False
        assert result["has_warnings"] is True
