import numpy as np

from app.services import rag_engine


class _FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeScalars:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values


class _FakeExecuteResult:
    def __init__(self, *, first_value=None, scalar_value=None, scalars_values=None):
        self._first_value = first_value
        self._scalar_value = scalar_value
        self._scalars_values = scalars_values or []

    def first(self):
        return self._first_value

    def scalar_one_or_none(self):
        return self._scalar_value

    def scalars(self):
        return _FakeScalars(self._scalars_values)

    def all(self):
        return self._scalars_values


class _FakeSession:
    def __init__(self, execute_results):
        self._execute_results = list(execute_results)
        self.commits = 0
        self.closed = False
        self.added = []

    def execute(self, _stmt):
        return self._execute_results.pop(0)

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True


def test_classify_segment_prefers_exact_match(monkeypatch):
    exact_entry = type("TM", (), {"target_text": "Bonjour"})()
    db = _FakeSession([
        _FakeExecuteResult(scalar_value=exact_entry),
    ])

    monkeypatch.setattr(rag_engine, "SessionLocal", lambda: db)

    match_type, translation, score = rag_engine.classify_segment(
        source_text="Hello",
        embedding=np.ones((384,), dtype=np.float32),
        target_language="fr",
    )

    assert match_type == "exact"
    assert translation == "Bonjour"
    assert score == 1.0
    assert db.closed is True


def test_classify_segment_returns_fuzzy_above_threshold(monkeypatch):
    tm_entry = type("TM", (), {"target_text": "Salut", "embedding": type("Vec", (), {"cosine_distance": lambda self, _vec: 0.0})()})()
    db = _FakeSession([
        _FakeExecuteResult(scalar_value=None),
        _FakeExecuteResult(first_value=(tm_entry, 0.08)),
    ])

    monkeypatch.setattr(rag_engine, "SessionLocal", lambda: db)

    match_type, translation, score = rag_engine.classify_segment(
        source_text="Hi",
        embedding=np.ones((384,), dtype=np.float32),
        target_language="fr",
    )

    assert match_type == "fuzzy"
    assert translation == "Salut"
    assert score > rag_engine.FUZZY_THRESHOLD
    assert db.closed is True


def test_classify_segment_returns_new_below_threshold(monkeypatch):
    tm_entry = type("TM", (), {"target_text": "Hola", "embedding": type("Vec", (), {"cosine_distance": lambda self, _vec: 0.0})()})()
    db = _FakeSession([
        _FakeExecuteResult(scalar_value=None),
        _FakeExecuteResult(first_value=(tm_entry, 0.2)),
    ])

    monkeypatch.setattr(rag_engine, "SessionLocal", lambda: db)

    match_type, translation, score = rag_engine.classify_segment(
        source_text="Hello",
        embedding=np.ones((384,), dtype=np.float32),
        target_language="es",
    )

    assert match_type == "new"
    assert translation is None
    assert score < rag_engine.FUZZY_THRESHOLD
    assert db.closed is True


def test_store_translation_overwrites_all_matching_entries(monkeypatch):
    entry_a = type("TM", (), {"target_text": "OldA", "document_id": "doc-old", "embedding": None})()
    entry_b = type("TM", (), {"target_text": "OldB", "document_id": "doc-old", "embedding": None})()
    db = _FakeSession([
        _FakeExecuteResult(scalars_values=[entry_a, entry_b]),
    ])

    monkeypatch.setattr(rag_engine, "SessionLocal", lambda: db)

    rag_engine.store_translation(
        source_text="Hello",
        target_text="Bonjour final",
        language="fr",
        embedding=np.ones((384,), dtype=np.float32),
        document_id="doc-new",
    )

    assert entry_a.target_text == "Bonjour final"
    assert entry_b.target_text == "Bonjour final"
    assert entry_a.document_id == "doc-new"
    assert entry_b.document_id == "doc-new"
    assert db.commits == 1
    assert db.closed is True
