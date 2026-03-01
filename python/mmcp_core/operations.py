"""
MMCP Operations — mirrors TypeScript src/operations/index.ts exactly.
All 5 DAG primitives: fork, merge, handoff, shard, verify.
"""
from __future__ import annotations
from .types import ContextEnvelope, MergeStrategy, ShardStrategy, Message
from .context import create_context, build_history


def fork(
    parent: ContextEnvelope,
    nodes: list[dict],
) -> list[ContextEnvelope]:
    """1 → N: spawn N parallel sub-contexts from a single parent."""
    return [
        create_context(
            task=parent.task,
            role=node["role"],
            model=node.get("model", parent.model),
            parent_ids=[parent.id],
            branch_type="fork",
            history=build_history([parent], parent.task, node["role"]),
            system_prompt=node.get("system_prompt"),
            depth=parent.depth + 1,
            max_retries=node.get("max_retries", 2),
        )
        for node in nodes
    ]


def merge(
    parents: list[ContextEnvelope],
    into: dict,
    strategy: MergeStrategy = "union",
) -> ContextEnvelope:
    """N → 1: combine multiple parent outputs into a single context."""
    if not parents:
        raise ValueError("merge() requires at least one parent")

    task = parents[0].task
    max_depth = max(p.depth for p in parents)

    history = build_history(parents, task, into["role"])
    if strategy == "weighted":
        sorted_parents = sorted(
            parents,
            key=lambda p: p.confidence or 0.5,
            reverse=True,
        )
        history = build_history(sorted_parents, task, into["role"])

    return create_context(
        task=task,
        role=into["role"],
        model=into.get("model", parents[0].model),
        parent_ids=[p.id for p in parents],
        branch_type="merge",
        history=history,
        system_prompt=into.get("system_prompt"),
        depth=max_depth + 1,
        merge_strategy=strategy,
        max_retries=into.get("max_retries", 2),
    )


def handoff(
    parent: ContextEnvelope,
    to: dict,
) -> ContextEnvelope:
    """1 → 1: pass context to a different model/role."""
    return create_context(
        task=parent.task,
        role=to["role"],
        model=to.get("model", parent.model),
        parent_ids=[parent.id],
        branch_type="handoff",
        history=build_history([parent], parent.task, to["role"]),
        system_prompt=to.get("system_prompt"),
        depth=parent.depth + 1,
        max_retries=to.get("max_retries", 2),
    )


def shard(
    parent: ContextEnvelope,
    n: int,
    role: str,
    strategy: ShardStrategy = "sequential",
    model: str | None = None,
) -> list[ContextEnvelope]:
    """1 → N: split long content across N parallel shards."""
    shards = []
    for i in range(n):
        pct = 100 // n
        start = i * pct
        end = 100 if i == n - 1 else start + pct
        if strategy == "sequential":
            shard_task = (
                f"[SHARD {i + 1}/{n} — covering {start}%-{end}% of content] "
                f"{parent.task}"
            )
        else:
            shard_task = f"[SHARD {i + 1}/{n}] {parent.task}"

        shards.append(create_context(
            task=shard_task,
            role=role,
            model=model or parent.model,
            parent_ids=[parent.id],
            branch_type="shard",
            history=[Message(role="user", content=shard_task)],
            depth=parent.depth + 1,
            shard_index=i,
        ))
    return shards


def verify(
    producer: ContextEnvelope,
    challenger_spec: dict,
    synthesizer_spec: dict,
) -> tuple[ContextEnvelope, ContextEnvelope]:
    """Trust contract: producer → challenger + synthesizer."""
    challenger = create_context(
        task=producer.task,
        role=challenger_spec["role"],
        model=challenger_spec.get("model", producer.model),
        parent_ids=[producer.id],
        branch_type="verify",
        history=build_history([producer], producer.task, challenger_spec["role"]),
        system_prompt=challenger_spec.get("system_prompt") or (
            "You are the CHALLENGER in an MMCP verification contract. "
            "Critically review the previous output. Find flaws, edge cases, "
            "incorrect assumptions. Be specific and constructive."
        ),
        depth=producer.depth + 1,
        metadata={"verify_role": "challenger"},
    )
    synthesizer = create_context(
        task=producer.task,
        role=synthesizer_spec["role"],
        model=synthesizer_spec.get("model", producer.model),
        parent_ids=[producer.id, challenger.id],  # DAG — 2 parents
        branch_type="merge",
        history=[],  # built at runtime from both parents
        system_prompt=synthesizer_spec.get("system_prompt") or (
            "You are the SYNTHESIZER in an MMCP verification contract. "
            "You have the original answer and a critical challenge. "
            "Produce the final, balanced, correct answer."
        ),
        depth=producer.depth + 2,
        merge_strategy="union",
        metadata={"verify_role": "synthesizer"},
    )
    return challenger, synthesizer
