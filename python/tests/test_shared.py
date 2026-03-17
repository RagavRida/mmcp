"""Tests for SharedContextStore — no API needed."""
from mmcp_core import SharedContextStore, SharedContextEntry
from mmcp_core.observer import MMCPObserver


def test_set_returns_entry():
    store = SharedContextStore()
    entry = store.set("key1", "value1", "ctx_1")
    assert isinstance(entry, SharedContextEntry)
    assert entry.key == "key1"
    assert entry.value == "value1"
    assert entry.author_ctx_id == "ctx_1"
    assert entry.version == 1


def test_append_only():
    store = SharedContextStore()
    store.set("key1", "v1", "ctx_1")
    store.set("key1", "v2", "ctx_2")
    store.set("key1", "v3", "ctx_3")
    entries = store.get("key1")
    assert len(entries) == 3
    assert entries[0].value == "v1"
    assert entries[1].value == "v2"
    assert entries[2].value == "v3"


def test_version_auto_increments():
    store = SharedContextStore()
    e1 = store.set("k", "a", "ctx_1")
    e2 = store.set("k", "b", "ctx_2")
    e3 = store.set("k", "c", "ctx_3")
    assert e1.version == 1
    assert e2.version == 2
    assert e3.version == 3


def test_latest():
    store = SharedContextStore()
    store.set("k", "first", "ctx_1")
    store.set("k", "second", "ctx_2")
    assert store.latest("k") == "second"
    assert store.latest("missing") is None


def test_latest_entry():
    store = SharedContextStore()
    store.set("k", "v", "ctx_1")
    entry = store.latest_entry("k")
    assert entry is not None
    assert entry.value == "v"
    assert store.latest_entry("missing") is None


def test_has():
    store = SharedContextStore()
    assert not store.has("k")
    store.set("k", "v", "ctx_1")
    assert store.has("k")


def test_keys():
    store = SharedContextStore()
    store.set("a", 1, "ctx")
    store.set("b", 2, "ctx")
    store.set("c", 3, "ctx")
    assert sorted(store.keys()) == ["a", "b", "c"]


def test_snapshot():
    store = SharedContextStore()
    store.set("x", "old", "ctx")
    store.set("x", "new", "ctx")
    store.set("y", 42, "ctx")
    snap = store.snapshot()
    assert snap == {"x": "new", "y": 42}


def test_history_sorted_by_timestamp():
    store = SharedContextStore()
    store.set("b", 2, "ctx")
    store.set("a", 1, "ctx")
    store.set("b", 3, "ctx")
    history = store.history()
    assert len(history) == 3
    timestamps = [e.timestamp for e in history]
    assert timestamps == sorted(timestamps)


def test_diff():
    store = SharedContextStore()
    e1 = store.set("a", 1, "ctx")
    since = e1.timestamp
    store.set("a", 2, "ctx")
    store.set("b", 3, "ctx")
    diff = store.diff(since)
    assert len(diff) == 2  # only entries after since


def test_clear_specific_key():
    store = SharedContextStore()
    store.set("a", 1, "ctx")
    store.set("b", 2, "ctx")
    store.clear("a")
    assert not store.has("a")
    assert store.has("b")


def test_clear_all():
    store = SharedContextStore()
    store.set("a", 1, "ctx")
    store.set("b", 2, "ctx")
    store.clear()
    assert store.keys() == []


def test_observer_emits_on_write():
    events = []
    observer = MMCPObserver()
    observer.on(lambda e: events.append(e))
    store = SharedContextStore()
    store.set("k", "v", "ctx_1", observer=observer)
    assert len(events) == 1
    assert events[0].type == "mmcp.shared.write"
    assert events[0].data["key"] == "k"


def test_metadata():
    store = SharedContextStore()
    entry = store.set("k", "v", "ctx_1", metadata={"source": "test"})
    assert entry.metadata == {"source": "test"}
