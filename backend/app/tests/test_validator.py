"""
Tests for validation module v3 (LLM-first architecture).

Covers:
  - Layer 1: Only double spaces detected (no false positives from old rules)
  - Layer 2: Mocked LLM for all 5 categories
  - No false positives: e.g., i.e., backend, hrs, domain terms all clean
  - Auto-fix: double space removal
  - apply_ai_fixes: AI suggestions applied to segments
  - update_segment_text: manual edits
  - Backward compat: result structure unchanged
  - Edge cases
"""

import pytest
from unittest.mock import patch

from app.services.validator import (
    validate_text,
    validate_segments,
    _fast_guard,
    _merge_issues,
    _build_term_summary,
    _parse_ai_response,
    _ai_validate,
    _ai_validate_batch,
    apply_ai_fixes,
    update_segment_text,
)


# ===========================================================================
# Layer 1: Fast Guard — only double spaces
# ===========================================================================

class TestFastGuard:
    """Layer 1 should ONLY detect double spaces."""

    def test_double_space_detected(self):
        issues = _fast_guard("This has  double spaces.")
        assert len(issues) == 1
        assert issues[0]["issue_type"] == "formatting"
        assert issues[0]["offset"] == 8

    def test_multiple_double_spaces(self):
        issues = _fast_guard("Fix  this  double  spacing.")
        assert len(issues) == 3

    def test_clean_text_no_issues(self):
        issues = _fast_guard("This is a perfectly clean sentence.")
        assert len(issues) == 0

    def test_single_space_not_flagged(self):
        issues = _fast_guard("Normal single spaces everywhere.")
        assert len(issues) == 0


# ===========================================================================
# Zero false positives — previously problematic cases
# ===========================================================================

class TestZeroFalsePositives:
    """All previously problematic texts must produce ZERO issues."""

    def test_eg_not_flagged(self):
        """'e.g.' must NOT trigger consistency false positive."""
        text = "The AI data services market is growing (e.g. West Coast)."
        result = validate_text(text, min_issue_severity="info")
        consistency = [i for i in result["issues"] if i["issue_type"] == "consistency"]
        assert len(consistency) == 0

    def test_ie_not_flagged(self):
        """'i.e.' must NOT trigger consistency false positive."""
        text = "The primary metric (i.e. revenue growth) is tracking well."
        result = validate_text(text, min_issue_severity="info")
        consistency = [i for i in result["issues"] if i["issue_type"] == "consistency"]
        assert len(consistency) == 0

    def test_backend_not_flagged(self):
        text = "The backend service handles all API requests."
        result = validate_text(text, min_issue_severity="info")
        spelling = [i for i in result["issues"] if i["issue_type"] == "spelling"]
        assert len(spelling) == 0

    def test_hrs_not_flagged(self):
        text = "The process takes approximately 3 hrs to complete."
        result = validate_text(text, min_issue_severity="info")
        spelling = [i for i in result["issues"] if i["issue_type"] == "spelling"]
        assert len(spelling) == 0

    def test_domain_terms_not_flagged(self):
        text = "The indemnification clause requires arbitration for liability."
        result = validate_text(text, min_issue_severity="info")
        spelling = [i for i in result["issues"] if i["issue_type"] == "spelling"]
        assert len(spelling) == 0

    def test_clean_text_zero_issues(self):
        text = "This is a perfectly clean sentence with no issues at all."
        result = validate_text(text, min_issue_severity="info")
        assert len(result["issues"]) == 0

    def test_repeated_punctuation_not_flagged_deterministic(self):
        """'!!' and '??' should NOT be flagged — removed from deterministic."""
        text = "Really?? That's amazing!!"
        result = validate_text(text, min_issue_severity="info", enable_ai=False)
        assert len(result["issues"]) == 0


# ===========================================================================
# Auto-fix
# ===========================================================================

class TestAutoFix:
    """Auto-fix should only fix double spaces."""

    def test_auto_fix_double_space(self):
        text = "Fix  this  double  spacing."
        result = validate_text(text, auto_fix=True)
        assert result["auto_fixed_text"] == "Fix this double spacing."

    def test_auto_fix_preserves_clean_text(self):
        text = "Already clean text."
        result = validate_text(text, auto_fix=True)
        assert result["auto_fixed_text"] == text


# ===========================================================================
# AI Response Parsing
# ===========================================================================

class TestAIResponseParsing:
    """Test the JSON response parser."""

    def test_parse_clean_json_array(self):
        raw = '[{"issue_type": "grammar", "severity": "error", "issue": "Wrong word", "suggestion": "Fix it", "span": "loose", "confidence": 0.95}]'
        result = _parse_ai_response(raw)
        assert len(result) == 1

    def test_parse_empty_array(self):
        assert _parse_ai_response("[]") == []

    def test_parse_markdown_fenced(self):
        raw = '```json\n[{"issue_type": "spelling", "severity": "warning", "issue": "typo", "suggestion": "fix", "span": "teh", "confidence": 0.9}]\n```'
        assert len(_parse_ai_response(raw)) == 1

    def test_parse_wrapped_in_object(self):
        raw = '{"issues": [{"issue_type": "grammar", "severity": "error", "issue": "test", "suggestion": "fix", "span": "x", "confidence": 0.8}]}'
        assert len(_parse_ai_response(raw)) == 1

    def test_parse_garbage_returns_empty(self):
        assert _parse_ai_response("Some random text") == []

    def test_parse_empty_string(self):
        assert _parse_ai_response("") == []


# ===========================================================================
# AI Validate (mocked LLM)
# ===========================================================================

class TestAIValidate:
    """Test AI validation with mocked LLM responses."""

    @patch("app.services.llm_service._call_llm")
    def test_ai_catches_wrong_word(self, mock_llm):
        mock_llm.return_value = '[{"issue_type": "wrong_word", "severity": "error", "issue": "Wrong word: loose should be lose", "suggestion": "lose", "span": "loose", "confidence": 0.95}]'
        issues = _ai_validate("The company will loose money.")
        assert len(issues) == 1
        assert issues[0]["issue_type"] == "wrong_word"
        assert issues[0]["source"] == "ai"

    @patch("app.services.llm_service._call_llm")
    def test_ai_returns_empty_for_clean_text(self, mock_llm):
        mock_llm.return_value = "[]"
        issues = _ai_validate("This is a perfectly written sentence.")
        assert issues == []

    def test_ai_skips_empty_text(self):
        assert _ai_validate("") == []

    @patch("app.services.llm_service._call_llm")
    def test_ai_receives_document_context(self, mock_llm):
        mock_llm.return_value = "[]"
        doc_context = {
            "document_type": "legal_contract",
            "domain": "legal",
            "register": "formal",
            "domain_keywords": ["indemnification", "liability"],
        }
        _ai_validate("The indemnification clause is binding.", document_context=doc_context)
        system_prompt = mock_llm.call_args[0][0]
        assert "legal_contract" in system_prompt
        assert "indemnification" in system_prompt

    @patch("app.services.llm_service._call_llm")
    def test_ai_formatting_category(self, mock_llm):
        mock_llm.return_value = '[{"issue_type": "formatting", "severity": "info", "issue": "Inconsistent capitalization", "suggestion": "API", "span": "api", "confidence": 0.7}]'
        issues = _ai_validate("The api endpoint works.")
        assert len(issues) == 1
        assert issues[0]["issue_type"] == "formatting"


# ===========================================================================
# Batch AI Validation
# ===========================================================================

class TestAIValidateBatch:
    """Test batched multi-segment AI validation."""

    @patch("app.services.llm_service._call_llm")
    def test_batch_returns_per_segment(self, mock_llm):
        mock_llm.return_value = '{"seg1": [{"issue_type": "grammar", "severity": "warning", "issue": "Missing article", "suggestion": "the report", "span": "report", "confidence": 0.8}], "seg2": []}'
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
        assert _ai_validate_batch(segments) == {}

    def test_batch_skips_skip_status(self):
        segments = [{"id": "seg1", "text": "Some text", "status": "skip"}]
        assert _ai_validate_batch(segments) == {}


# ===========================================================================
# Merge Issues
# ===========================================================================

class TestMergeIssues:
    """Test deduplication between deterministic and AI layers."""

    def test_overlapping_issues_merged(self):
        det = [{"issue_type": "formatting", "issue": "Double space", "suggestion": " ",
                "severity": "warning", "offset": 5, "length": 2, "source": "deterministic", "confidence": 1.0}]
        ai = [{"issue_type": "formatting", "issue": "Extra space detected",
               "suggestion": " ", "severity": "warning", "offset": 5, "length": 2,
               "confidence": 0.95, "source": "ai"}]
        merged = _merge_issues(det, ai)
        assert len(merged) == 1
        assert merged[0]["source"] == "merged"

    def test_non_overlapping_kept_separate(self):
        det = [{"issue_type": "formatting", "issue": "Double space", "suggestion": " ",
                "severity": "warning", "offset": 5, "length": 2, "source": "deterministic", "confidence": 1.0}]
        ai = [{"issue_type": "grammar", "issue": "Missing article", "suggestion": "the cat",
               "severity": "warning", "offset": 20, "length": 3, "confidence": 0.8, "source": "ai"}]
        merged = _merge_issues(det, ai)
        assert len(merged) == 2

    def test_empty_ai_returns_deterministic(self):
        det = [{"issue_type": "formatting", "issue": "test", "suggestion": "fix",
                "severity": "warning", "offset": 0, "length": 4, "source": "deterministic", "confidence": 1.0}]
        assert len(_merge_issues(det, [])) == 1

    def test_empty_both_returns_empty(self):
        assert _merge_issues([], []) == []


# ===========================================================================
# Cross-segment term summary
# ===========================================================================

class TestCrossSegmentConsistency:
    """Test term summary extraction."""

    def test_term_summary_extracts_frequent_terms(self):
        segments = [
            {"text": "The client requested a new feature. The client needs it urgently."},
            {"text": "Our customer support team handles customer complaints."},
        ]
        summary = _build_term_summary(segments)
        assert summary is not None
        assert "client" in summary
        assert "customer" in summary

    def test_term_summary_empty_segments(self):
        segments = [{"text": ""}, {"text": "   "}]
        assert _build_term_summary(segments) is None


# ===========================================================================
# Apply AI Fixes
# ===========================================================================

class TestApplyAIFixes:
    """Test the auto-apply AI fixes functionality."""

    @patch("app.services.validator._ai_validate_batch")
    def test_apply_fixes_updates_segment_text(self, mock_batch):
        mock_batch.return_value = {
            "seg1": [{
                "issue_type": "spelling",
                "issue": "Typo: 'teh' should be 'the'",
                "suggestion": "the",
                "severity": "error",
                "offset": 0,
                "length": 3,
                "span": "Teh",
                "confidence": 0.95,
                "source": "ai",
            }],
        }
        segments = [{"id": "seg1", "text": "Teh quick brown fox."}]
        result = apply_ai_fixes(segments)

        assert result["fixed_count"] == 1
        assert segments[0]["text"] == "the quick brown fox."
        assert result["fixes"][0]["original"] == "Teh quick brown fox."
        assert result["fixes"][0]["fixed"] == "the quick brown fox."

    @patch("app.services.validator._ai_validate_batch")
    def test_apply_fixes_skips_clean_segments(self, mock_batch):
        mock_batch.return_value = {"seg1": []}
        segments = [{"id": "seg1", "text": "Clean text."}]
        result = apply_ai_fixes(segments)
        assert result["fixed_count"] == 0

    @patch("app.services.validator._ai_validate_batch")
    def test_apply_fixes_specific_segments(self, mock_batch):
        mock_batch.return_value = {
            "seg2": [{
                "issue_type": "grammar",
                "issue": "Wrong word",
                "suggestion": "lose",
                "severity": "error",
                "offset": 17,
                "length": 5,
                "span": "loose",
                "confidence": 0.9,
                "source": "ai",
            }],
        }
        segments = [
            {"id": "seg1", "text": "First segment."},
            {"id": "seg2", "text": "The company will loose money."},
        ]
        result = apply_ai_fixes(segments, segment_ids=["seg2"])
        assert result["fixed_count"] == 1
        assert segments[1]["text"] == "The company will lose money."

    def test_apply_fixes_empty_segments(self):
        result = apply_ai_fixes([])
        assert result["fixed_count"] == 0


# ===========================================================================
# Update Segment Text (manual edit)
# ===========================================================================

class TestUpdateSegmentText:
    """Test manual segment editing."""

    def test_update_segment_text(self):
        segments = [
            {"id": "seg1", "text": "Old text with typo."},
            {"id": "seg2", "text": "Another segment."},
        ]
        result = update_segment_text(segments, "seg1", "New corrected text.")
        assert result is not None
        assert result["old_text"] == "Old text with typo."
        assert result["new_text"] == "New corrected text."
        assert result["status"] == "edited"
        assert segments[0]["text"] == "New corrected text."
        assert segments[0]["status"] == "edited"

    def test_update_nonexistent_segment(self):
        segments = [{"id": "seg1", "text": "Some text."}]
        result = update_segment_text(segments, "seg99", "New text.")
        assert result is None

    def test_update_preserves_other_segments(self):
        segments = [
            {"id": "seg1", "text": "First."},
            {"id": "seg2", "text": "Second."},
        ]
        update_segment_text(segments, "seg1", "Updated first.")
        assert segments[1]["text"] == "Second."


# ===========================================================================
# Integration: validate_text & validate_segments
# ===========================================================================

class TestIntegration:
    """Integration tests for the public API."""

    def test_result_structure(self):
        result = validate_text("Simple test.")
        assert "segment_id" in result
        assert "text" in result
        assert "issues" in result
        assert "auto_fixed_text" in result
        assert "has_errors" in result
        assert "has_warnings" in result

    def test_segment_id_propagation(self):
        result = validate_text("Test  text.", segment_id="my-seg", min_issue_severity="warning")
        for issue in result["issues"]:
            assert issue.get("segment_id") == "my-seg"

    @patch("app.services.llm_service._call_llm")
    def test_validate_text_with_ai(self, mock_llm):
        mock_llm.return_value = '[{"issue_type": "wrong_word", "severity": "error", "issue": "loose should be lose", "suggestion": "lose", "span": "loose", "confidence": 0.95}]'
        result = validate_text("The company will loose money.", enable_ai=True)
        ai_issues = [i for i in result["issues"] if i.get("source") in ("ai", "merged")]
        assert len(ai_issues) >= 1
        assert result["has_errors"] is True

    def test_validate_segments_skip_status(self):
        segments = [{"id": "seg1", "text": "Some text.", "status": "skip"}]
        assert validate_segments(segments) == []

    def test_validate_segments_only_with_issues(self):
        segments = [
            {"id": "seg1", "text": "Perfectly clean sentence here."},
            {"id": "seg2", "text": "Another clean sentence."},
        ]
        results = validate_segments(segments, only_with_issues=True)
        assert len(results) == 0

    def test_validate_segments_none_text(self):
        segments = [{"id": "seg1"}]
        assert validate_segments(segments) == []


# ===========================================================================
# Edge Cases
# ===========================================================================

class TestEdgeCases:

    def test_empty_string(self):
        result = validate_text("")
        assert result["issues"] == []

    def test_unicode_text(self):
        text = "The café serves naïve résumé holders."
        result = validate_text(text, min_issue_severity="info")
        assert isinstance(result["issues"], list)

    def test_very_long_text(self):
        text = "This is a sentence. " * 500
        result = validate_text(text)
        assert isinstance(result["issues"], list)
