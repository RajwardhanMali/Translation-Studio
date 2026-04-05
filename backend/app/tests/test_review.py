import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest

from app.models.schemas import ApproveRequest
from app.routers.review import approve_segment
from app.services.collaboration import BackendCollaborator


class _FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self._result


class _FakeSession:
    def __init__(self, segment, document):
        self._segment = segment
        self._document = document
        self.committed = False

    def query(self, model):
        model_name = getattr(model, "__name__", "")
        if model_name == "Segment":
            return _FakeQuery(self._segment)
        if model_name == "Document":
            return _FakeQuery(self._document)
        return _FakeQuery(None)

    def commit(self):
        self.committed = True


def test_owner_can_approve_segment_and_trigger_learning(monkeypatch):
    segment = SimpleNamespace(
        id="seg-1",
        document_id="doc-1",
        text="Source",
        translated_text="Translated",
        correction=None,
        final_text=None,
        status="reviewed",
        updated_at=None,
    )
    document = SimpleNamespace(id="doc-1", metadata_json={"target_language": "fr"})
    db = _FakeSession(segment=segment, document=document)

    owner = BackendCollaborator(clerk_user_id="owner-1", email="owner@test.com", name="Owner")
    membership = SimpleNamespace(role="owner")

    monkeypatch.setattr("app.routers.review.ensure_collaboration_tables", lambda _db: None)
    monkeypatch.setattr("app.routers.review.enrich_collaborator", lambda _db, collaborator: owner)
    monkeypatch.setattr(
        "app.routers.review.require_document_role",
        lambda _db, _doc_id, _collaborator, allowed_roles: membership,
    )
    monkeypatch.setattr(
        "app.routers.review.require_segment_assignment",
        lambda _db, _doc_id, _segment_ids, _collaborator, _membership: None,
    )

    learning_calls = []

    def _capture_learning(segment, target_language):
        learning_calls.append((segment, target_language))

    monkeypatch.setattr("app.routers.review.on_segment_approved", _capture_learning)

    request = ApproveRequest(segment_id="seg-1", approved=True, correction="Final owner edit")
    response = asyncio.run(approve_segment(request, db=db, collaborator=owner))

    assert response.segment_id == "seg-1"
    assert response.status == "approved"
    assert response.final_text == "Final owner edit"
    assert segment.status == "approved"
    assert segment.final_text == "Final owner edit"
    assert isinstance(segment.updated_at, datetime)
    assert db.committed is True
    assert len(learning_calls) == 1
    assert learning_calls[0][1] == "fr"


@pytest.mark.parametrize("role", ["owner", "editor"])
def test_approve_accepts_owner_and_editor_roles(monkeypatch, role):
    segment = SimpleNamespace(
        id="seg-2",
        document_id="doc-2",
        text="Source",
        translated_text="Translated",
        correction=None,
        final_text=None,
        status="reviewed",
        updated_at=None,
    )
    document = SimpleNamespace(id="doc-2", metadata_json={"target_language": "es"})
    db = _FakeSession(segment=segment, document=document)

    collaborator = BackendCollaborator(clerk_user_id=f"{role}-1", email=f"{role}@test.com", name=role.title())

    monkeypatch.setattr("app.routers.review.ensure_collaboration_tables", lambda _db: None)
    monkeypatch.setattr("app.routers.review.enrich_collaborator", lambda _db, _collaborator: collaborator)

    captured_roles = []

    def _capture_require_role(_db, _doc_id, _collaborator, allowed_roles):
        captured_roles.append(tuple(allowed_roles))
        return SimpleNamespace(role=role)

    monkeypatch.setattr("app.routers.review.require_document_role", _capture_require_role)
    monkeypatch.setattr(
        "app.routers.review.require_segment_assignment",
        lambda _db, _doc_id, _segment_ids, _collaborator, _membership: None,
    )
    monkeypatch.setattr("app.routers.review.on_segment_approved", lambda *args, **kwargs: None)

    request = ApproveRequest(segment_id="seg-2", approved=True, correction=None)
    response = asyncio.run(approve_segment(request, db=db, collaborator=collaborator))

    assert response.status == "approved"
    assert ("owner", "editor") in captured_roles
