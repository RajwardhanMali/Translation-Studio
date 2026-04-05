from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import Header, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.domain import (
    Document,
    DocumentCollaborator,
    Segment as SegmentDB,
    SegmentAssignment,
    SegmentLock,
    User,
)

LOCK_TTL_SECONDS = 120


@dataclass
class BackendCollaborator:
    clerk_user_id: str
    email: Optional[str]
    name: Optional[str]


def ensure_collaboration_tables(db: Session) -> None:
    statements = [
        "CREATE EXTENSION IF NOT EXISTS pgcrypto",
        """
        CREATE TABLE IF NOT EXISTS document_collaborators (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id text NOT NULL,
          collaborator_clerk_user_id text NOT NULL,
          collaborator_email text NOT NULL,
          collaborator_name text,
          role text NOT NULL DEFAULT 'viewer',
          added_by_clerk_user_id text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS document_collaborators_doc_user_uidx
        ON document_collaborators (document_id, collaborator_clerk_user_id)
        """,
        """
        CREATE TABLE IF NOT EXISTS segment_assignments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          segment_id text NOT NULL,
          document_id text NOT NULL,
          assigned_to_clerk_user_id text NOT NULL,
          assigned_to_email text NOT NULL,
          assigned_to_name text,
          assigned_by_clerk_user_id text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS segment_assignments_segment_uidx
        ON segment_assignments (segment_id)
        """,
        """
        CREATE TABLE IF NOT EXISTS segment_locks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          segment_id text NOT NULL,
          document_id text NOT NULL,
          locked_by_clerk_user_id text NOT NULL,
          locked_by_email text NOT NULL,
          locked_by_name text,
          expires_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """,
        """
        CREATE UNIQUE INDEX IF NOT EXISTS segment_locks_segment_uidx
        ON segment_locks (segment_id)
        """,
    ]

    for statement in statements:
        db.execute(text(statement))
    db.commit()


def get_current_backend_collaborator(
    x_clerk_user_id: Optional[str] = Header(default=None, alias="X-Clerk-User-Id"),
) -> BackendCollaborator:
    if not x_clerk_user_id:
        raise HTTPException(status_code=401, detail="Missing authenticated collaborator header.")
    return BackendCollaborator(clerk_user_id=x_clerk_user_id, email=None, name=None)


def enrich_collaborator(db: Session, collaborator: BackendCollaborator) -> BackendCollaborator:
    user = db.query(User).filter(User.clerk_user_id == collaborator.clerk_user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Authenticated collaborator is not registered.")
    return BackendCollaborator(
        clerk_user_id=user.clerk_user_id,
        email=user.email,
        name=user.name,
    )


def get_document_membership(
    db: Session,
    document_id: str,
    clerk_user_id: str,
) -> Optional[DocumentCollaborator]:
    sync_document_owner_membership(db, document_id)
    return (
        db.query(DocumentCollaborator)
        .filter(DocumentCollaborator.document_id == document_id)
        .filter(DocumentCollaborator.collaborator_clerk_user_id == clerk_user_id)
        .first()
    )


def sync_document_owner_membership(db: Session, document_id: str) -> None:
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document or not document.user_id:
        return

    owner_user = db.query(User).filter(User.clerk_user_id == document.user_id).first()
    if not owner_user:
        return

    membership = (
        db.query(DocumentCollaborator)
        .filter(DocumentCollaborator.document_id == document_id)
        .filter(DocumentCollaborator.collaborator_clerk_user_id == owner_user.clerk_user_id)
        .first()
    )

    now = datetime.utcnow()
    if membership:
        updated = False
        if membership.role != "owner":
            membership.role = "owner"
            updated = True
        if membership.collaborator_email != owner_user.email:
            membership.collaborator_email = owner_user.email
            updated = True
        if membership.collaborator_name != owner_user.name:
            membership.collaborator_name = owner_user.name
            updated = True
        if membership.added_by_clerk_user_id != owner_user.clerk_user_id:
            membership.added_by_clerk_user_id = owner_user.clerk_user_id
            updated = True
        if updated:
            membership.updated_at = now
            db.commit()
        return

    db.add(
        DocumentCollaborator(
            document_id=document_id,
            collaborator_clerk_user_id=owner_user.clerk_user_id,
            collaborator_email=owner_user.email,
            collaborator_name=owner_user.name,
            role="owner",
            added_by_clerk_user_id=owner_user.clerk_user_id,
            created_at=now,
            updated_at=now,
        )
    )
    db.commit()


def require_document_membership(
    db: Session,
    document_id: str,
    collaborator: BackendCollaborator,
) -> DocumentCollaborator:
    membership = get_document_membership(db, document_id, collaborator.clerk_user_id)
    if not membership:
        raise HTTPException(status_code=403, detail="You do not have access to this document.")
    return membership


def require_document_role(
    db: Session,
    document_id: str,
    collaborator: BackendCollaborator,
    allowed_roles: List[str],
) -> DocumentCollaborator:
    membership = require_document_membership(db, document_id, collaborator)
    if membership.role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Your collaborator role does not allow this action.")
    return membership


def get_assignment_map(db: Session, document_id: str) -> Dict[str, SegmentAssignment]:
    assignments = (
        db.query(SegmentAssignment)
        .filter(SegmentAssignment.document_id == document_id)
        .all()
    )
    return {assignment.segment_id: assignment for assignment in assignments}


def get_active_lock_map(db: Session, document_id: str) -> Dict[str, SegmentLock]:
    now = datetime.utcnow()
    expired = (
        db.query(SegmentLock)
        .filter(SegmentLock.document_id == document_id)
        .filter(SegmentLock.expires_at <= now)
        .all()
    )
    if expired:
        for lock in expired:
            db.delete(lock)
        db.commit()

    locks = (
        db.query(SegmentLock)
        .filter(SegmentLock.document_id == document_id)
        .filter(SegmentLock.expires_at > now)
        .all()
    )
    return {lock.segment_id: lock for lock in locks}


def require_segment_assignment(
    db: Session,
    document_id: str,
    segment_ids: List[str],
    collaborator: BackendCollaborator,
    membership: DocumentCollaborator,
) -> None:
    if membership.role == "owner":
        return

    assignments = get_assignment_map(db, document_id)
    for segment_id in segment_ids:
        assignment = assignments.get(segment_id)
        if not assignment:
            raise HTTPException(status_code=409, detail=f"Segment '{segment_id}' is not assigned yet.")
        if assignment.assigned_to_clerk_user_id != collaborator.clerk_user_id:
            raise HTTPException(status_code=403, detail=f"Segment '{segment_id}' is assigned to another collaborator.")


def attach_collaboration_fields(
    segment_dict: Dict,
    assignment: Optional[SegmentAssignment],
    lock: Optional[SegmentLock],
) -> Dict:
    if assignment:
        segment_dict["assigned_to_clerk_user_id"] = assignment.assigned_to_clerk_user_id
        segment_dict["assigned_to_name"] = assignment.assigned_to_name
        segment_dict["assigned_to_email"] = assignment.assigned_to_email
    if lock:
        segment_dict["locked_by_clerk_user_id"] = lock.locked_by_clerk_user_id
        segment_dict["locked_by_name"] = lock.locked_by_name
        segment_dict["locked_by_email"] = lock.locked_by_email
        segment_dict["lock_expires_at"] = lock.expires_at.isoformat()
    return segment_dict


def assign_segments(
    db: Session,
    document_id: str,
    segment_ids: List[str],
    assignee: User,
    actor_clerk_user_id: str,
) -> List[SegmentAssignment]:
    now = datetime.utcnow()
    results: List[SegmentAssignment] = []

    for segment_id in segment_ids:
        assignment = (
            db.query(SegmentAssignment)
            .filter(SegmentAssignment.segment_id == segment_id)
            .first()
        )

        if assignment:
            assignment.assigned_to_clerk_user_id = assignee.clerk_user_id
            assignment.assigned_to_email = assignee.email
            assignment.assigned_to_name = assignee.name
            assignment.assigned_by_clerk_user_id = actor_clerk_user_id
            assignment.updated_at = now
        else:
            assignment = SegmentAssignment(
                segment_id=segment_id,
                document_id=document_id,
                assigned_to_clerk_user_id=assignee.clerk_user_id,
                assigned_to_email=assignee.email,
                assigned_to_name=assignee.name,
                assigned_by_clerk_user_id=actor_clerk_user_id,
                created_at=now,
                updated_at=now,
            )
            db.add(assignment)

        results.append(assignment)

    db.commit()
    return results


def lock_segment(
    db: Session,
    document_id: str,
    segment_id: str,
    collaborator: BackendCollaborator,
    membership: DocumentCollaborator,
) -> SegmentLock:
    require_segment_assignment(db, document_id, [segment_id], collaborator, membership)

    active_locks = get_active_lock_map(db, document_id)
    existing = active_locks.get(segment_id)
    now = datetime.utcnow()
    expires_at = now + timedelta(seconds=LOCK_TTL_SECONDS)

    if existing and existing.locked_by_clerk_user_id != collaborator.clerk_user_id:
        raise HTTPException(status_code=409, detail="This segment is currently being edited by another collaborator.")

    if existing:
        existing.expires_at = expires_at
        existing.updated_at = now
        db.commit()
        return existing

    lock = SegmentLock(
        segment_id=segment_id,
        document_id=document_id,
        locked_by_clerk_user_id=collaborator.clerk_user_id,
        locked_by_email=collaborator.email or "",
        locked_by_name=collaborator.name,
        expires_at=expires_at,
        created_at=now,
        updated_at=now,
    )
    db.add(lock)
    db.commit()
    return lock


def unlock_segment(
    db: Session,
    document_id: str,
    segment_id: str,
    collaborator: BackendCollaborator,
    membership: DocumentCollaborator,
) -> bool:
    lock = (
        db.query(SegmentLock)
        .filter(SegmentLock.document_id == document_id)
        .filter(SegmentLock.segment_id == segment_id)
        .first()
    )
    if not lock:
        return True

    if membership.role != "owner" and lock.locked_by_clerk_user_id != collaborator.clerk_user_id:
        raise HTTPException(status_code=403, detail="You cannot unlock a segment locked by another collaborator.")

    db.delete(lock)
    db.commit()
    return True


def find_assignee_membership_or_404(db: Session, document_id: str, clerk_user_id: str) -> User:
    collaborator = (
        db.query(DocumentCollaborator)
        .filter(DocumentCollaborator.document_id == document_id)
        .filter(DocumentCollaborator.collaborator_clerk_user_id == clerk_user_id)
        .first()
    )
    if not collaborator:
        raise HTTPException(status_code=404, detail="Assignee is not a collaborator on this document.")
    if collaborator.role != "editor":
        raise HTTPException(status_code=400, detail="Segments can only be assigned to editors.")

    user = db.query(User).filter(User.clerk_user_id == clerk_user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Assignee is not a registered user.")
    return user


def validate_segment_ids_for_document(db: Session, document_id: str, segment_ids: List[str]) -> None:
    if not segment_ids:
        raise HTTPException(status_code=400, detail="At least one segment_id is required.")

    count = (
        db.query(SegmentDB)
        .filter(SegmentDB.document_id == document_id)
        .filter(SegmentDB.id.in_(segment_ids))
        .count()
    )
    if count != len(set(segment_ids)):
        raise HTTPException(status_code=400, detail="One or more segments do not belong to this document.")


def ensure_document_exists(db: Session, document_id: str) -> Document:
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Document '{document_id}' not found.")
    return doc
