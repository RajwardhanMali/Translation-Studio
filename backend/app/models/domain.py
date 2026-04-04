from sqlalchemy import Column, String, Integer, Float, Boolean, ForeignKey, DateTime, Text, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from pgvector.sqlalchemy import Vector
from app.database import Base

def generate_uuid():
    return str(uuid.uuid4())

from sqlalchemy.dialects.postgresql import UUID

class User(Base):
    __tablename__ = "app_users"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    clerk_user_id = Column(String, unique=True, nullable=False, index=True)
    email = Column(String, nullable=False)
    name = Column(String, nullable=True)
    avatar_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    documents = relationship("Document", back_populates="user")
    segments = relationship("Segment", back_populates="user")
    glossary_terms = relationship("GlossaryTerm", back_populates="user")

class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    user_id = Column(String, ForeignKey("app_users.clerk_user_id", ondelete="CASCADE"), index=True, nullable=True)
    filename = Column(String, index=True, nullable=False)
    file_type = Column(String, nullable=False)
    firebase_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String, default="parsed")  # e.g., parsed, segmented, translating

    # Using JSON to store the parsed blocks as it's sequential and usually retrieved as a whole
    blocks = Column(JSON, default=list)
    metadata_json = Column(JSON, default=dict)

    user = relationship("User", back_populates="documents")
    segments = relationship("Segment", back_populates="document", cascade="all, delete-orphan")

class Segment(Base):
    __tablename__ = "segments"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    document_id = Column(String, ForeignKey("documents.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id = Column(String, ForeignKey("app_users.clerk_user_id", ondelete="CASCADE"), index=True, nullable=True)
    
    text = Column(Text, nullable=False)
    translated_text = Column(Text, nullable=True)
    correction = Column(Text, nullable=True)
    final_text = Column(Text, nullable=True)
    
    type = Column(String, default="paragraph")
    status = Column(String, default="pending")  # pending, reviewed, approved, skip
    parent_id = Column(String, nullable=True)
    block_type = Column(String, default="paragraph")
    
    position = Column(JSON, default=dict)
    format_snapshot = Column(JSON, default=dict)
    
    tm_match_type = Column(String, nullable=True)
    tm_score = Column(Float, nullable=True)
    
    row = Column(Integer, nullable=True)
    col = Column(Integer, nullable=True)
    
    table_index = Column(Integer, nullable=True)
    row_count = Column(Integer, nullable=True)
    col_count = Column(Integer, nullable=True)
    col_widths = Column(JSON, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    document = relationship("Document", back_populates="segments")
    user = relationship("User", back_populates="segments")

class TranslationMemory(Base):
    __tablename__ = "translation_memory"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    user_id = Column(String, ForeignKey("app_users.clerk_user_id", ondelete="CASCADE"), index=True, nullable=True)
    document_id = Column(String, ForeignKey("documents.id", ondelete="SET NULL"), index=True, nullable=True)
    
    language = Column(String, index=True, nullable=False)
    source_text = Column(Text, nullable=False)
    target_text = Column(Text, nullable=False)
    
    # Sentence-transformer typically produces 384 or 768 dim depending on model.
    # The default miniLM is 384. Vector(384)
    embedding = Column(Vector(384), nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)

class GlossaryTerm(Base):
    __tablename__ = "glossary_terms"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    user_id = Column(String, ForeignKey("app_users.clerk_user_id", ondelete="CASCADE"), index=True, nullable=True)
    
    source = Column(String, nullable=False)
    target = Column(String, nullable=False)
    language = Column(String, default="fr", index=True)
    domain = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="glossary_terms")
