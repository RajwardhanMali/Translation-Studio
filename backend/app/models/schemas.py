"""
Pydantic schemas for the Translation Studio API.
Defines all request/response models used across the application.
"""

from __future__ import annotations
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field
from datetime import datetime
import uuid


# ---------------------------------------------------------------------------
# Document schemas
# ---------------------------------------------------------------------------

class BlockPosition(BaseModel):
    """Position metadata for a parsed block."""
    block_index: int
    sentence_index: Optional[int] = None
    phrase_index: Optional[int] = None


class ParsedBlock(BaseModel):
    """A single parsed block from a document (heading, paragraph, table cell)."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    document_id: str
    block_type: Literal["heading", "paragraph", "table_cell", "table"]
    text: str
    level: Optional[int] = None          # heading level (1-6)
    row: Optional[int] = None            # table row index
    col: Optional[int] = None            # table column index
    table_index: Optional[int] = None    # which table in the doc
    position: BlockPosition


class ParsedDocument(BaseModel):
    """Full parsed document with all blocks."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    filename: str
    file_type: Literal["pdf", "docx"]
    blocks: List[ParsedBlock]
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    metadata: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Segment schemas
# ---------------------------------------------------------------------------

class SegmentPosition(BaseModel):
    """Fine-grained position within a document."""
    block_index: int
    sentence_index: Optional[int] = None
    phrase_index: Optional[int] = None


class Segment(BaseModel):
    """
    Core unit of translation.
    Represents a sentence or phrase extracted from a document block.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    document_id: str
    text: str
    type: str   # sentence | phrase | heading | table_cell | spacer | image | table_start | table_end
    translated_text: Optional[str] = None      # raw LLM translation
    correction: Optional[str] = None           # human correction
    final_text: Optional[str] = None           # approved final output
    status: str = "pending"                  # pending | reviewed | approved | skip
    parent_id: Optional[str] = None            # parent segment/block id
    block_type: str = "paragraph"
    position: SegmentPosition
    format_snapshot: Dict[str, Any] = Field(default_factory=dict)   # formatting for reconstruction
    tm_match_type: Optional[str] = None
    tm_score: Optional[float] = None
    row: Optional[int] = None
    col: Optional[int] = None
    # Table structural extras (for table_start blocks)
    table_index: Optional[int] = None
    row_count: Optional[int] = None
    col_count: Optional[int] = None
    col_widths: Optional[List[float]] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class SegmentedDocument(BaseModel):
    """All segments for a document."""
    document_id: str
    segments: List[Segment]
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


# ---------------------------------------------------------------------------
# Validation schemas
# ---------------------------------------------------------------------------

class ValidationIssue(BaseModel):
    """A single validation issue found in source text."""
    segment_id: Optional[str] = None
    issue_type: Literal[
        "spelling", "grammar", "consistency", "punctuation",
        "formatting", "wrong_word", "clarity", "style"
    ]
    issue: str
    suggestion: str
    severity: Literal["error", "warning", "info"]
    offset: Optional[int] = None
    length: Optional[int] = None
    confidence: Optional[float] = None
    source: Optional[str] = None


class ValidationResult(BaseModel):
    """Validation result for a document or segment."""
    document_id: Optional[str] = None
    segment_id: Optional[str] = None
    text: str
    issues: List[ValidationIssue]
    auto_fixed_text: Optional[str] = None
    has_errors: bool = False
    has_warnings: bool = False


class ValidateRequest(BaseModel):
    """Request body for validation endpoint."""
    document_id: Optional[str] = None
    text: Optional[str] = None
    auto_fix: bool = False
    enable_ai: bool = False


class ApplyFixesRequest(BaseModel):
    """Request to auto-apply AI-suggested fixes to segments."""
    document_id: str
    segment_ids: Optional[List[str]] = None    # if None, fix all segments


class SegmentFix(BaseModel):
    """Result of an auto-applied fix on a single segment."""
    segment_id: str
    original: str
    fixed: str
    issues_fixed: int


class ApplyFixesResponse(BaseModel):
    """Response from auto-apply endpoint."""
    document_id: str
    fixed_count: int
    fixes: List[SegmentFix]


class EditSegmentRequest(BaseModel):
    """Request to manually edit a segment's source text."""
    document_id: str
    segment_id: str
    new_text: str


class EditSegmentResponse(BaseModel):
    """Response from segment edit endpoint."""
    segment_id: str
    old_text: str
    new_text: str
    status: str


# ---------------------------------------------------------------------------
# Translation schemas
# ---------------------------------------------------------------------------

class TranslateRequest(BaseModel):
    """Request body to trigger translation of a document or segment."""
    document_id: str
    target_language: str = "fr"
    style_rules: List[str] = Field(default_factory=list)
    segment_ids: Optional[List[str]] = None   # translate only these segments
    pre_validate: bool = False                # run AI validation before translation


class TranslateResponse(BaseModel):
    """Response after translation."""
    document_id: str
    segments_translated: int
    segments: List[Segment]


# ---------------------------------------------------------------------------
# Review / Approval schemas
# ---------------------------------------------------------------------------

class ApproveRequest(BaseModel):
    """Approve or correct a single segment."""
    segment_id: str
    correction: Optional[str] = None    # human-provided correction
    approved: bool = True


class ApproveResponse(BaseModel):
    """Response after approving a segment."""
    segment_id: str
    status: str
    final_text: str


# ---------------------------------------------------------------------------
# Glossary schemas
# ---------------------------------------------------------------------------

class GlossaryTerm(BaseModel):
    """A single glossary entry."""
    source: str
    target: str
    language: str = "fr"
    domain: Optional[str] = None
    notes: Optional[str] = None


class GlossaryResponse(BaseModel):
    """Full glossary with style rules."""
    terms: List[GlossaryTerm]
    style_rules: List[str]


class AddGlossaryTermRequest(BaseModel):
    """Request to add a new glossary term."""
    term: GlossaryTerm


# ---------------------------------------------------------------------------
# Upload response
# ---------------------------------------------------------------------------

class UploadResponse(BaseModel):
    """Response after uploading and parsing a document."""
    document_id: str
    filename: str
    file_type: str
    blocks_parsed: int
    message: str
    document_type: Optional[str] = None     # e.g., "legal_contract", "technical_documentation"
    domain: Optional[str] = None            # e.g., "legal", "technical", "medical"
    doc_register: Optional[str] = None      # e.g., "formal", "informal"


# ---------------------------------------------------------------------------
# Document listing schemas
# ---------------------------------------------------------------------------

class SegmentProgress(BaseModel):
    total: int
    pending: int
    reviewed: int
    approved: int


class DocumentSummary(BaseModel):
    """Summary card returned by GET /documents."""
    id: str
    filename: str
    file_type: str
    created_at: Optional[str] = None
    blocks_count: int
    segments: SegmentProgress
    translation_progress: float   # 0.0 – 100.0 percent


# ---------------------------------------------------------------------------
# LLM backend info
# ---------------------------------------------------------------------------

class LLMBackendInfo(BaseModel):
    backend: str
    model: Optional[str] = None
    host: Optional[str] = None
    key_set: Optional[bool] = None