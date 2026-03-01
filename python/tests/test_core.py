"""Tests for core context/types module — no API needed."""
import pytest
from mmcp_core import create_context, build_history, Message
from mmcp_core.context import topological_sort, parents_ready

HAIKU = "claude-haiku-4-5-20251001"


def test_create_context_has_full_uuid():
    ctx = create_context(task="test", role="tester", model=HAIKU)
    assert ctx.id.startswith("ctx_")
    assert len(ctx.id) == 4 + 32  # "ctx_" + 32 hex chars


def test_create_context_defaults():
    ctx = create_context(task="test", role="tester", model=HAIKU)
    assert ctx.mmcp_version == "1.0"
    assert ctx.parent_ids == []
    assert ctx.children == []
    assert ctx.status == "pending"
    assert ctx.retry_count == 0
    assert ctx.max_retries == 2
    assert ctx.branch_type == "handoff"
    assert ctx.depth == 0


def test_create_context_with_parent_ids():
    ctx = create_context(
        task="test", role="tester", model=HAIKU,
        parent_ids=["p1", "p2"], branch_type="merge"
    )
    assert ctx.parent_ids == ["p1", "p2"]
    assert ctx.branch_type == "merge"


def test_build_history_single_parent():
    parent = create_context(task="t", role="a", model=HAIKU)
    parent.output = "Hello from parent"
    parent.history = [Message(role="user", content="initial task")]
    history = build_history([parent], "t", "b")
    assert len(history) == 2
    assert history[0].content == "initial task"
    assert history[1].role == "assistant"
    assert history[1].content == "Hello from parent"


def test_build_history_multiple_parents():
    p1 = create_context(task="t", role="a", model=HAIKU)
    p1.output = "Output A"
    p2 = create_context(task="t", role="b", model=HAIKU)
    p2.output = "Output B"
    history = build_history([p1, p2], "t", "synthesizer")
    assert len(history) == 1
    assert "[A]:" in history[0].content
    assert "[B]:" in history[0].content


def test_topological_sort_linear():
    a = create_context(task="t", role="a", model=HAIKU, branch_type="root")
    b = create_context(task="t", role="b", model=HAIKU, parent_ids=[a.id])
    c = create_context(task="t", role="c", model=HAIKU, parent_ids=[b.id])
    result = topological_sort([c, a, b])
    ids = [ctx.id for ctx in result]
    assert ids.index(a.id) < ids.index(b.id) < ids.index(c.id)


def test_topological_sort_diamond():
    root = create_context(task="t", role="r", model=HAIKU)
    left = create_context(task="t", role="l", model=HAIKU, parent_ids=[root.id])
    right = create_context(task="t", role="r", model=HAIKU, parent_ids=[root.id])
    merge = create_context(
        task="t", role="m", model=HAIKU,
        parent_ids=[left.id, right.id]
    )
    result = topological_sort([merge, right, root, left])
    ids = [ctx.id for ctx in result]
    assert ids.index(root.id) < ids.index(left.id)
    assert ids.index(root.id) < ids.index(right.id)
    assert ids.index(left.id) < ids.index(merge.id)
    assert ids.index(right.id) < ids.index(merge.id)


def test_cycle_detection():
    a = create_context(task="t", role="a", model=HAIKU)
    b = create_context(task="t", role="b", model=HAIKU, parent_ids=[a.id])
    a.parent_ids = [b.id]  # create cycle
    with pytest.raises(ValueError, match="cycle detected"):
        topological_sort([a, b])


def test_parents_ready():
    a = create_context(task="t", role="a", model=HAIKU)
    b = create_context(task="t", role="b", model=HAIKU)
    c = create_context(
        task="t", role="c", model=HAIKU,
        parent_ids=[a.id, b.id]
    )
    ctx_map = {a.id: a, b.id: b, c.id: c}
    assert not parents_ready(c, ctx_map)  # both pending
    a.status = "done"
    assert not parents_ready(c, ctx_map)  # only one done
    b.status = "done"
    assert parents_ready(c, ctx_map)  # both done


def test_parents_ready_root():
    root = create_context(task="t", role="r", model=HAIKU)
    assert parents_ready(root, {root.id: root})
