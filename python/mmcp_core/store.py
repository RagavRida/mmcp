"""
MMCP MemoryStore — mirrors TypeScript src/store/memory.ts exactly.
In-memory DAG storage with parent-child tracking.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional
from .types import ContextEnvelope, ContextStatus


class MemoryStore:
    def __init__(self) -> None:
        self._store: dict[str, ContextEnvelope] = {}

    async def save(self, context: ContextEnvelope) -> None:
        self._store[context.id] = context
        for pid in context.parent_ids:
            parent = self._store.get(pid)
            if parent and context.id not in parent.children:
                parent.children.append(context.id)

    async def get(self, ctx_id: str) -> Optional[ContextEnvelope]:
        return self._store.get(ctx_id)

    async def get_many(self, ids: list[str]) -> list[ContextEnvelope]:
        return [self._store[i] for i in ids if i in self._store]

    async def update_status(
        self,
        ctx_id: str,
        status: ContextStatus,
        output: str | None = None,
        extra: dict | None = None,
    ) -> None:
        ctx = self._store.get(ctx_id)
        if not ctx:
            raise ValueError(f"Context {ctx_id} not found")
        ctx.status = status
        if output is not None:
            ctx.output = output
        if extra:
            for k, v in extra.items():
                if hasattr(ctx, k):
                    setattr(ctx, k, v)
        now = datetime.now(timezone.utc).isoformat()
        if status == "running":
            ctx.started_at = now
        if status in ("done", "failed", "skipped"):
            ctx.completed_at = now
            if ctx.started_at:
                start = datetime.fromisoformat(ctx.started_at)
                end = datetime.fromisoformat(ctx.completed_at)
                ctx.duration_ms = int((end - start).total_seconds() * 1000)

    async def get_roots(self) -> list[ContextEnvelope]:
        return [c for c in self._store.values() if not c.parent_ids]

    def dump(self) -> list[ContextEnvelope]:
        return list(self._store.values())

    def print_dag(self) -> None:
        contexts = self.dump()
        STATUS_ICON = {
            "done": "✓", "failed": "✗", "running": "⟳",
            "pending": "○", "skipped": "–",
        }
        BRANCH_COLOR = {
            "root": "\033[36m", "fork": "\033[33m", "merge": "\033[35m",
            "handoff": "\033[32m", "shard": "\033[34m", "verify": "\033[31m",
        }
        RESET = "\033[0m"

        def print_node(ctx: ContextEnvelope, prefix: str, is_last: bool) -> None:
            icon = STATUS_ICON.get(ctx.status, "?")
            color = BRANCH_COLOR.get(ctx.branch_type, "")
            tokens = f" [{ctx.tokens_used}t]" if ctx.tokens_used else ""
            model_short = "-".join(ctx.model.split("-")[-2:]) if ctx.model else ""
            print(
                f"{prefix}{'└─' if is_last else '├─'} "
                f"{color}[{ctx.branch_type}]{RESET} "
                f"{icon} {ctx.role} ({model_short}){tokens}"
            )
            children = [c for c in contexts if ctx.id in c.parent_ids]
            for i, child in enumerate(children):
                print_node(
                    child,
                    prefix + ("   " if is_last else "│  "),
                    i == len(children) - 1,
                )

        print("\n📊 MMCP Context DAG:")
        roots = [c for c in contexts if not c.parent_ids]
        for i, root in enumerate(roots):
            print_node(root, "", i == len(roots) - 1)
        print()
