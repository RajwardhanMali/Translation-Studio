import asyncio
from types import SimpleNamespace

from app.models.schemas import TranslateRequest
from app.routers import translation as translation_router
from app.services.collaboration import BackendCollaborator


class _FakeDB:
    def __init__(self):
        self.commits = 0

    def commit(self):
        self.commits += 1


def test_classify_translation_memory_skips_force_llm_segments(monkeypatch):
    segments = [
        {"id": "seg-force", "text": "Repeat me", "force_llm": True},
        {"id": "seg-normal", "text": "Repeat me", "force_llm": False},
    ]

    monkeypatch.setattr(translation_router, "encode_texts", lambda _texts: [SimpleNamespace()])

    calls = {"count": 0}

    def _fake_classify(_text, _embedding, target_language):
        calls["count"] += 1
        return "fuzzy", "TM candidate", 0.95

    monkeypatch.setattr(translation_router, "classify_segment", _fake_classify)

    unique = translation_router._classify_translation_memory(segments, "fr")

    assert len(unique) == 2
    assert calls["count"] == 1

    force_segment = next(item for item in segments if item["id"] == "seg-force")
    normal_segment = next(item for item in segments if item["id"] == "seg-normal")

    assert force_segment["tm_match_type"] == "new"
    assert normal_segment["tm_match_type"] == "fuzzy"


def test_translate_document_stores_tm_after_translation(monkeypatch):
    request = TranslateRequest(document_id="doc-1", target_language="fr")
    collaborator = BackendCollaborator(clerk_user_id="owner-1", email="o@test.com", name="Owner")
    db = _FakeDB()

    all_segments = [
        {
            "id": "seg-1",
            "document_id": "doc-1",
            "text": "Hello",
            "translated_text": "Bonjour",
            "status": "reviewed",
            "type": "sentence",
            "position": {"block_index": 0},
        }
    ]

    monkeypatch.setattr("app.routers.translation.enrich_collaborator", lambda _db, _collab: collaborator)
    monkeypatch.setattr(
        "app.routers.translation.require_document_role",
        lambda _db, _doc_id, _collab, _roles: SimpleNamespace(role="owner"),
    )
    monkeypatch.setattr(
        "app.routers.translation._prepare_translation_context",
        lambda _request, _db: (
            SimpleNamespace(metadata_json={}),
            [],
            all_segments,
            [],
            all_segments,
            {},
            "",
            [],
        ),
    )
    monkeypatch.setattr("app.routers.translation._run_translation_batches", lambda **_kwargs: [])
    monkeypatch.setattr("app.routers.translation._persist_segments", lambda _a, _b: None)
    monkeypatch.setattr("app.routers.translation.get_assignment_map", lambda _db, _doc_id: {})

    captured = {}

    def _capture_store(segments, language):
        captured["segments"] = segments
        captured["language"] = language

    monkeypatch.setattr("app.routers.translation._store_tm_from_segments", _capture_store)

    response = asyncio.run(translation_router.translate_document(request, db=db, collaborator=collaborator))

    assert response.document_id == "doc-1"
    assert captured["segments"] is all_segments
    assert captured["language"] == "fr"


def test_translate_stream_stores_tm_on_completion(monkeypatch):
    request = TranslateRequest(document_id="doc-1", target_language="fr")
    collaborator = BackendCollaborator(clerk_user_id="owner-1", email="o@test.com", name="Owner")
    db = _FakeDB()

    all_segments = [
        {
            "id": "seg-1",
            "document_id": "doc-1",
            "text": "Hello",
            "translated_text": "Bonjour",
            "status": "reviewed",
            "type": "sentence",
            "position": {"block_index": 0},
        }
    ]

    monkeypatch.setattr("app.routers.translation.enrich_collaborator", lambda _db, _collab: collaborator)
    monkeypatch.setattr(
        "app.routers.translation.require_document_role",
        lambda _db, _doc_id, _collab, _roles: SimpleNamespace(role="owner"),
    )
    monkeypatch.setattr(
        "app.routers.translation._prepare_translation_context",
        lambda _request, _db: (
            SimpleNamespace(metadata_json={}),
            [],
            all_segments,
            [],
            all_segments,
            {},
            "",
            [],
        ),
    )
    monkeypatch.setattr("app.routers.translation._run_translation_batches", lambda **_kwargs: [])
    monkeypatch.setattr("app.routers.translation._persist_segments", lambda _a, _b: None)
    monkeypatch.setattr("app.routers.translation.get_assignment_map", lambda _db, _doc_id: {})

    captured = {"count": 0}

    def _capture_store(segments, language):
        captured["count"] += 1
        captured["segments"] = segments
        captured["language"] = language

    monkeypatch.setattr("app.routers.translation._store_tm_from_segments", _capture_store)

    response = asyncio.run(translation_router.translate_document_stream(request, db=db, collaborator=collaborator))

    chunks = []
    async def _collect():
        async for part in response.body_iterator:
            chunks.append(part)

    asyncio.run(_collect())

    assert chunks
    assert captured["count"] == 1
    assert captured["segments"] is all_segments
    assert captured["language"] == "fr"
