"""Tests for operations + real API integration."""
import pytest
import os
from mmcp_core import (
    MMCPOrchestrator, RoleBasedRouter, MemoryStore,
    fork, merge, handoff, shard, verify, create_context,
)

HAIKU = "claude-haiku-4-5-20251001"


def make_orc():
    return MMCPOrchestrator({
        "router": RoleBasedRouter({
            role: {"model_id": HAIKU}
            for role in [
                "architect", "coder", "verifier", "summarizer",
                "challenger", "synthesizer", "reasoner", "orchestrator",
            ]
        }),
        "store": MemoryStore(),
    })


# ── Unit tests — no API needed ──────────────────────────────────────────────


def test_fork_creates_n_children():
    parent = create_context(
        task="t", role="root", model=HAIKU, branch_type="root"
    )
    children = fork(parent, [{"role": "a"}, {"role": "b"}, {"role": "c"}])
    assert len(children) == 3
    for child in children:
        assert child.parent_ids == [parent.id]
        assert child.branch_type == "fork"
        assert child.depth == 1


def test_merge_parent_ids_is_array():
    p1 = create_context(task="t", role="a", model=HAIKU)
    p2 = create_context(task="t", role="b", model=HAIKU)
    p1.status = "done"
    p1.output = "out A"
    p2.status = "done"
    p2.output = "out B"
    merged = merge([p1, p2], {"role": "summarizer"})
    assert len(merged.parent_ids) == 2
    assert p1.id in merged.parent_ids
    assert p2.id in merged.parent_ids
    assert merged.branch_type == "merge"


def test_merge_requires_parents():
    with pytest.raises(ValueError, match="at least one parent"):
        merge([], {"role": "summarizer"})


def test_handoff_depth_increments():
    parent = create_context(task="t", role="a", model=HAIKU)
    child = handoff(parent, {"role": "b"})
    assert child.depth == parent.depth + 1
    assert child.parent_ids == [parent.id]
    assert child.branch_type == "handoff"


def test_verify_synthesizer_has_two_parents():
    producer = create_context(
        task="t", role="expert", model=HAIKU, branch_type="root"
    )
    challenger, synthesizer = verify(
        producer, {"role": "challenger"}, {"role": "synthesizer"}
    )
    assert challenger.parent_ids == [producer.id]
    assert len(synthesizer.parent_ids) == 2
    assert producer.id in synthesizer.parent_ids
    assert challenger.id in synthesizer.parent_ids


def test_shard_index_starts_at_zero():
    parent = create_context(task="t", role="r", model=HAIKU)
    shards = shard(parent, 3, "summarizer")
    assert len(shards) == 3
    for i, s in enumerate(shards):
        assert s.shard_index == i
        assert s.branch_type == "shard"


# ── Integration tests — real API ────────────────────────────────────────────

API_KEY = os.environ.get("ANTHROPIC_API_KEY")
skip_no_api = pytest.mark.skipif(
    not API_KEY, reason="ANTHROPIC_API_KEY not set"
)


@skip_no_api
@pytest.mark.asyncio
async def test_run_chain_real():
    orc = make_orc()
    result = await orc.run_chain(
        "What is 2+2? Answer in one sentence.",
        ["architect", "verifier"],
    )
    assert result.success
    assert result.total_nodes == 2
    assert result.output
    assert result.total_tokens > 0
    assert result.total_cost_usd > 0


@skip_no_api
@pytest.mark.asyncio
async def test_run_parallel_real():
    orc = make_orc()
    result = await orc.run_parallel(
        "Name one benefit of Python",
        ["coder", "reasoner"],
        "summarizer",
    )
    assert result.success
    assert result.total_nodes == 4


@skip_no_api
@pytest.mark.asyncio
async def test_run_verify_real():
    orc = make_orc()
    result = await orc.run_verify(
        "Is Python faster than C++?",
        "architect", "challenger", "synthesizer",
    )
    assert result.success
    synth = next(c for c in result.dag if c.role == "synthesizer")
    assert len(synth.parent_ids) == 2  # DAG proof
