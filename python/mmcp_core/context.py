"""
MMCP Context — mirrors TypeScript src/core/context.ts exactly.
Context creation, history building, topological sort with cycle detection.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from .types import (
    ContextEnvelope, BranchType, Message,
    MergeStrategy, MMCP_VERSION
)


def create_context(
    task: str,
    role: str,
    model: str,
    parent_ids: list[str] | None = None,
    branch_type: BranchType = "handoff",
    history: list[Message] | None = None,
    system_prompt: str | None = None,
    depth: int = 0,
    shard_index: int | None = None,
    merge_strategy: MergeStrategy | None = None,
    max_retries: int = 2,
    metadata: dict | None = None,
    required_skills: list[str] | None = None,
    matched_skills: list[str] | None = None,
    missing_skills: list[str] | None = None,
) -> ContextEnvelope:
    """Create a new ContextEnvelope with full 128-bit UUID."""
    ctx_id = f"ctx_{uuid.uuid4().hex}"
    return ContextEnvelope(
        mmcp_version=MMCP_VERSION,
        id=ctx_id,
        parent_ids=parent_ids or [],
        children=[],
        task=task,
        history=history or [],
        model=model,
        role=role,
        branch_type=branch_type,
        depth=depth,
        shard_index=shard_index,
        merge_strategy=merge_strategy,
        status="pending",
        retry_count=0,
        max_retries=max_retries,
        created_at=datetime.now(timezone.utc).isoformat(),
        metadata=metadata or {},
        system_prompt=system_prompt,
        required_skills=required_skills,
        matched_skills=matched_skills,
        missing_skills=missing_skills,
    )


def build_history(
    parent_contexts: list[ContextEnvelope],
    task: str,
    role: str,
) -> list[Message]:
    """Build history by collecting parent outputs."""
    history: list[Message] = []

    if len(parent_contexts) == 1:
        parent = parent_contexts[0]
        history.extend(parent.history)
        if parent.output:
            history.append(Message(role="assistant", content=parent.output))
    elif len(parent_contexts) > 1:
        parts = "\n\n---\n\n".join(
            f"[{p.role.upper()}]:\n{p.output}"
            for p in parent_contexts if p.output
        )
        history.append(Message(
            role="user",
            content=(
                f"You are the {role}. Multiple agents completed their tasks. "
                f"Here are their outputs:\n\n{parts}\n\nTask: {task}"
            ),
        ))

    return history


def topological_sort(contexts: list[ContextEnvelope]) -> list[ContextEnvelope]:
    """Topological sort with cycle detection via visiting set."""
    ctx_map = {c.id: c for c in contexts}
    visited: set[str] = set()
    visiting: set[str] = set()  # tracks current DFS path
    result: list[ContextEnvelope] = []

    def visit(ctx_id: str) -> None:
        if ctx_id in visited:
            return
        if ctx_id in visiting:
            raise ValueError(
                f"MMCP cycle detected: context {ctx_id} is its own ancestor. "
                f"DAG must be acyclic. Check parent_ids for circular references."
            )
        ctx = ctx_map.get(ctx_id)
        if not ctx:
            return

        visiting.add(ctx_id)
        for pid in ctx.parent_ids:
            visit(pid)
        visiting.remove(ctx_id)
        visited.add(ctx_id)
        result.append(ctx)

    for ctx in contexts:
        visit(ctx.id)

    return result


def parents_ready(
    context: ContextEnvelope,
    all_contexts: dict[str, ContextEnvelope],
) -> bool:
    """Check if all parents of a context are done."""
    if not context.parent_ids:
        return True
    return all(
        all_contexts.get(pid) is not None and all_contexts[pid].status == "done"
        for pid in context.parent_ids
    )
