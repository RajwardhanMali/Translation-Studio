import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.schemas import AssignSegmentsRequest
from app.routers.collaboration import claim_document_segments
from app.services.collaboration import BackendCollaborator, find_assignee_membership_or_404


class _FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self._result


class _FakeSession:
    def __init__(self, collaborator, user):
        self._collaborator = collaborator
        self._user = user

    def query(self, model):
        model_name = getattr(model, "__name__", "")
        if model_name == "DocumentCollaborator":
            return _FakeQuery(self._collaborator)
        if model_name == "User":
            return _FakeQuery(self._user)
        return _FakeQuery(None)


def test_claim_owner_is_forced_to_self(monkeypatch):
    request = AssignSegmentsRequest(
        document_id="doc-1",
        segment_ids=["seg-1"],
        assignee_clerk_user_id="someone-else",
    )

    owner = BackendCollaborator(clerk_user_id="owner-1", email="owner@test.com", name="Owner")
    membership = SimpleNamespace(role="owner")
    assignment = SimpleNamespace(
        segment_id="seg-1",
        document_id="doc-1",
        assigned_to_clerk_user_id="owner-1",
        assigned_to_email="owner@test.com",
        assigned_to_name="Owner",
        assigned_by_clerk_user_id="owner-1",
        updated_at=datetime.utcnow(),
    )
    assignee = SimpleNamespace(clerk_user_id="owner-1", email="owner@test.com", name="Owner")

    captured = {}

    monkeypatch.setattr("app.routers.collaboration.ensure_collaboration_tables", lambda db: None)
    monkeypatch.setattr("app.routers.collaboration.enrich_collaborator", lambda db, collaborator: owner)
    monkeypatch.setattr("app.routers.collaboration.require_document_role", lambda db, doc_id, collaborator, roles: membership)
    monkeypatch.setattr("app.routers.collaboration.validate_segment_ids_for_document", lambda db, doc_id, segment_ids: None)

    def _fake_find_assignee(db, document_id, clerk_user_id, allow_non_editors=False):
        captured["document_id"] = document_id
        captured["clerk_user_id"] = clerk_user_id
        captured["allow_non_editors"] = allow_non_editors
        return assignee

    monkeypatch.setattr("app.routers.collaboration.find_assignee_membership_or_404", _fake_find_assignee)
    monkeypatch.setattr("app.routers.collaboration.assign_segments", lambda **kwargs: [assignment])

    response = asyncio.run(claim_document_segments(request, db=object(), collaborator=owner))

    assert response.document_id == "doc-1"
    assert len(response.assignments) == 1
    assert response.assignments[0].assigned_to_clerk_user_id == "owner-1"
    assert captured == {
        "document_id": "doc-1",
        "clerk_user_id": "owner-1",
        "allow_non_editors": True,
    }


def test_claim_editor_for_other_user_forbidden(monkeypatch):
    request = AssignSegmentsRequest(
        document_id="doc-1",
        segment_ids=["seg-1"],
        assignee_clerk_user_id="user-2",
    )

    editor = BackendCollaborator(clerk_user_id="user-1", email="editor@test.com", name="Editor")
    membership = SimpleNamespace(role="editor")

    monkeypatch.setattr("app.routers.collaboration.ensure_collaboration_tables", lambda db: None)
    monkeypatch.setattr("app.routers.collaboration.enrich_collaborator", lambda db, collaborator: editor)
    monkeypatch.setattr("app.routers.collaboration.require_document_role", lambda db, doc_id, collaborator, roles: membership)
    monkeypatch.setattr("app.routers.collaboration.validate_segment_ids_for_document", lambda db, doc_id, segment_ids: None)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(claim_document_segments(request, db=object(), collaborator=editor))

    assert exc.value.status_code == 403
    assert "Editors can only claim segments for themselves" in exc.value.detail


def test_find_assignee_membership_rejects_non_editor_by_default():
    collaborator = SimpleNamespace(role="owner")
    user = SimpleNamespace(clerk_user_id="owner-1", email="owner@test.com", name="Owner")
    db = _FakeSession(collaborator=collaborator, user=user)

    with pytest.raises(HTTPException) as exc:
        find_assignee_membership_or_404(db, "doc-1", "owner-1")

    assert exc.value.status_code == 400
    assert "Segments can only be assigned to editors" in exc.value.detail


def test_find_assignee_membership_allows_non_editor_when_enabled():
    collaborator = SimpleNamespace(role="owner")
    user = SimpleNamespace(clerk_user_id="owner-1", email="owner@test.com", name="Owner")
    db = _FakeSession(collaborator=collaborator, user=user)

    result = find_assignee_membership_or_404(db, "doc-1", "owner-1", allow_non_editors=True)

    assert result.clerk_user_id == "owner-1"
