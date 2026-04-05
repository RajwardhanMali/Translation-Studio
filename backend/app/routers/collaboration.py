import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.domain import DocumentCollaborator
from app.models.schemas import (
    AssignSegmentsRequest,
    AssignSegmentsResponse,
    CollaborationStateResponse,
    DocumentCollaboratorState,
    LockSegmentRequest,
    LockSegmentResponse,
    SegmentAssignmentState,
    SegmentLockState,
    UnlockSegmentResponse,
)
from app.services.collaboration import (
    assign_segments,
    enrich_collaborator,
    ensure_collaboration_tables,
    find_assignee_membership_or_404,
    get_active_lock_map,
    get_assignment_map,
    get_current_backend_collaborator,
    lock_segment,
    require_document_membership,
    require_document_role,
    unlock_segment,
    validate_segment_ids_for_document,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/collaboration", tags=["collaboration"])


def _collaborator_state(member: DocumentCollaborator) -> DocumentCollaboratorState:
    return DocumentCollaboratorState(
        document_id=member.document_id,
        collaborator_clerk_user_id=member.collaborator_clerk_user_id,
        collaborator_email=member.collaborator_email,
        collaborator_name=member.collaborator_name,
        role=member.role,
    )


def _assignment_state(assignment) -> SegmentAssignmentState:
    return SegmentAssignmentState(
        segment_id=assignment.segment_id,
        document_id=assignment.document_id,
        assigned_to_clerk_user_id=assignment.assigned_to_clerk_user_id,
        assigned_to_email=assignment.assigned_to_email,
        assigned_to_name=assignment.assigned_to_name,
        assigned_by_clerk_user_id=assignment.assigned_by_clerk_user_id,
        updated_at=assignment.updated_at.isoformat() if assignment.updated_at else None,
    )


def _lock_state(lock) -> SegmentLockState:
    return SegmentLockState(
        segment_id=lock.segment_id,
        document_id=lock.document_id,
        locked_by_clerk_user_id=lock.locked_by_clerk_user_id,
        locked_by_email=lock.locked_by_email,
        locked_by_name=lock.locked_by_name,
        expires_at=lock.expires_at.isoformat(),
        updated_at=lock.updated_at.isoformat() if lock.updated_at else None,
    )


@router.get("/document/{document_id}", response_model=CollaborationStateResponse)
async def get_collaboration_state(
    document_id: str,
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    ensure_collaboration_tables(db)
    collaborator = enrich_collaborator(db, collaborator)
    membership = require_document_membership(db, document_id, collaborator)

    collaborators = (
        db.query(DocumentCollaborator)
        .filter(DocumentCollaborator.document_id == document_id)
        .all()
    )
    assignments = list(get_assignment_map(db, document_id).values())
    locks = list(get_active_lock_map(db, document_id).values())

    return CollaborationStateResponse(
        document_id=document_id,
        current_role=membership.role,
        collaborators=[_collaborator_state(member) for member in collaborators],
        assignments=[_assignment_state(item) for item in assignments],
        active_locks=[_lock_state(item) for item in locks],
    )


@router.post("/assign", response_model=AssignSegmentsResponse)
async def assign_document_segments(
    request: AssignSegmentsRequest,
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    ensure_collaboration_tables(db)
    collaborator = enrich_collaborator(db, collaborator)
    require_document_role(db, request.document_id, collaborator, ["owner"])
    validate_segment_ids_for_document(db, request.document_id, request.segment_ids)
    assignee = find_assignee_membership_or_404(db, request.document_id, request.assignee_clerk_user_id)

    assignments = assign_segments(
        db=db,
        document_id=request.document_id,
        segment_ids=request.segment_ids,
        assignee=assignee,
        actor_clerk_user_id=collaborator.clerk_user_id,
    )

    return AssignSegmentsResponse(
        document_id=request.document_id,
        assignments=[_assignment_state(item) for item in assignments],
    )


@router.post("/claim", response_model=AssignSegmentsResponse)
async def claim_document_segments(
    request: AssignSegmentsRequest,
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    ensure_collaboration_tables(db)
    collaborator = enrich_collaborator(db, collaborator)
    membership = require_document_role(db, request.document_id, collaborator, ["editor", "owner"])
    validate_segment_ids_for_document(db, request.document_id, request.segment_ids)

    if membership.role == "editor" and request.assignee_clerk_user_id != collaborator.clerk_user_id:
        raise HTTPException(status_code=403, detail="Editors can only claim segments for themselves.")

    assignee_user_id = collaborator.clerk_user_id if membership.role == "editor" else request.assignee_clerk_user_id
    assignee = find_assignee_membership_or_404(db, request.document_id, assignee_user_id)

    assignments = assign_segments(
        db=db,
        document_id=request.document_id,
        segment_ids=request.segment_ids,
        assignee=assignee,
        actor_clerk_user_id=collaborator.clerk_user_id,
    )
    return AssignSegmentsResponse(
        document_id=request.document_id,
        assignments=[_assignment_state(item) for item in assignments],
    )


@router.post("/lock", response_model=LockSegmentResponse)
async def acquire_segment_lock(
    request: LockSegmentRequest,
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    ensure_collaboration_tables(db)
    collaborator = enrich_collaborator(db, collaborator)
    membership = require_document_role(db, request.document_id, collaborator, ["editor", "owner"])
    validate_segment_ids_for_document(db, request.document_id, [request.segment_id])
    lock = lock_segment(db, request.document_id, request.segment_id, collaborator, membership)
    return LockSegmentResponse(document_id=request.document_id, lock=_lock_state(lock))


@router.post("/unlock", response_model=UnlockSegmentResponse)
async def release_segment_lock(
    request: LockSegmentRequest,
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    ensure_collaboration_tables(db)
    collaborator = enrich_collaborator(db, collaborator)
    membership = require_document_role(db, request.document_id, collaborator, ["editor", "owner"])
    unlocked = unlock_segment(db, request.document_id, request.segment_id, collaborator, membership)
    return UnlockSegmentResponse(
        document_id=request.document_id,
        segment_id=request.segment_id,
        unlocked=unlocked,
    )
