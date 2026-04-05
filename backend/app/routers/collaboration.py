import logging
from asyncio import Lock
from collections import defaultdict
from typing import Dict, Set

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.models.domain import DocumentCollaborator
from app.models.schemas import (
    AssignSegmentsRequest,
    AssignSegmentsResponse,
    CollaborationStateResponse,
    DocumentCollaboratorState,
    SegmentAssignmentState,
)
from app.services.collaboration import (
    assign_segments,
    enrich_collaborator,
    find_assignee_membership_or_404,
    get_assignment_map,
    get_current_backend_collaborator,
    BackendCollaborator,
    require_document_membership,
    require_document_role,
    validate_segment_ids_for_document,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/collaboration", tags=["collaboration"])


class _PresenceWebSocketManager:
    def __init__(self) -> None:
        self._lock = Lock()
        self._doc_sockets: Dict[str, Set[WebSocket]] = defaultdict(set)
        self._doc_users: Dict[str, Dict[str, Dict[str, str | None]]] = defaultdict(dict)
        self._doc_user_connections: Dict[str, Dict[str, int]] = defaultdict(dict)

    async def connect(self, document_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._doc_sockets[document_id].add(websocket)

    async def register_user(
        self,
        document_id: str,
        clerk_user_id: str,
        user_payload: Dict[str, str | None],
    ) -> None:
        async with self._lock:
            current = self._doc_user_connections[document_id].get(clerk_user_id, 0)
            self._doc_user_connections[document_id][clerk_user_id] = current + 1
            self._doc_users[document_id][clerk_user_id] = user_payload

    async def disconnect(self, document_id: str, websocket: WebSocket, clerk_user_id: str) -> None:
        async with self._lock:
            sockets = self._doc_sockets.get(document_id)
            if sockets and websocket in sockets:
                sockets.remove(websocket)

            current = self._doc_user_connections.get(document_id, {}).get(clerk_user_id, 0)
            if current <= 1:
                self._doc_user_connections.get(document_id, {}).pop(clerk_user_id, None)
                self._doc_users.get(document_id, {}).pop(clerk_user_id, None)
            else:
                self._doc_user_connections[document_id][clerk_user_id] = current - 1

            if document_id in self._doc_sockets and not self._doc_sockets[document_id]:
                self._doc_sockets.pop(document_id, None)
                self._doc_users.pop(document_id, None)
                self._doc_user_connections.pop(document_id, None)

    async def broadcast_presence(self, document_id: str) -> None:
        async with self._lock:
            sockets = list(self._doc_sockets.get(document_id, set()))
            users = list(self._doc_users.get(document_id, {}).values())

        payload = {
            "type": "presence",
            "document_id": document_id,
            "active_users": users,
        }

        stale_sockets: list[WebSocket] = []
        for socket in sockets:
            try:
                await socket.send_json(payload)
            except Exception:
                stale_sockets.append(socket)

        if stale_sockets:
            async with self._lock:
                active_sockets = self._doc_sockets.get(document_id)
                if active_sockets:
                    for stale in stale_sockets:
                        active_sockets.discard(stale)


presence_ws_manager = _PresenceWebSocketManager()


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





@router.get("/document/{document_id}", response_model=CollaborationStateResponse)
async def get_collaboration_state(
    document_id: str,
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
    collaborator = enrich_collaborator(db, collaborator)
    membership = require_document_membership(db, document_id, collaborator)

    collaborators = (
        db.query(DocumentCollaborator)
        .filter(DocumentCollaborator.document_id == document_id)
        .all()
    )
    assignments = list(get_assignment_map(db, document_id).values())

    return CollaborationStateResponse(
        document_id=document_id,
        current_role=membership.role,
        collaborators=[_collaborator_state(member) for member in collaborators],
        assignments=[_assignment_state(item) for item in assignments],
    )


@router.post("/assign", response_model=AssignSegmentsResponse)
async def assign_document_segments(
    request: AssignSegmentsRequest,
    db: Session = Depends(get_db),
    collaborator=Depends(get_current_backend_collaborator),
):
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
    collaborator = enrich_collaborator(db, collaborator)
    membership = require_document_role(db, request.document_id, collaborator, ["editor", "owner"])
    validate_segment_ids_for_document(db, request.document_id, request.segment_ids)

    if membership.role == "editor" and request.assignee_clerk_user_id != collaborator.clerk_user_id:
        raise HTTPException(status_code=403, detail="Editors can only claim segments for themselves.")

    # Claim is always self-claim for the authenticated collaborator.
    assignee_user_id = collaborator.clerk_user_id
    assignee = find_assignee_membership_or_404(
        db,
        request.document_id,
        assignee_user_id,
        allow_non_editors=True,
    )

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


@router.websocket("/presence/ws/{document_id}")
async def collaboration_presence_ws(websocket: WebSocket, document_id: str):
    clerk_user_id = websocket.query_params.get("clerk_user_id")
    if not clerk_user_id:
        await websocket.close(code=4401, reason="Missing clerk_user_id.")
        return

    await websocket.accept()
    await presence_ws_manager.connect(document_id, websocket)

    db = SessionLocal()
    try:
        collaborator = enrich_collaborator(
            db,
            BackendCollaborator(
                clerk_user_id=clerk_user_id,
                email=None,
                name=None,
            ),
        )
        membership = require_document_membership(db, document_id, collaborator)
    except HTTPException as exc:
        db.close()
        await websocket.close(code=4403, reason=exc.detail)
        return

    db.close()

    user_payload = {
        "id": f"{document_id}:{collaborator.clerk_user_id}",
        "document_id": document_id,
        "collaborator_clerk_user_id": collaborator.clerk_user_id,
        "collaborator_email": collaborator.email,
        "collaborator_name": collaborator.name,
        "role": membership.role,
    }

    await presence_ws_manager.register_user(document_id, collaborator.clerk_user_id, user_payload)
    await presence_ws_manager.broadcast_presence(document_id)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await presence_ws_manager.disconnect(document_id, websocket, collaborator.clerk_user_id)
        await presence_ws_manager.broadcast_presence(document_id)



