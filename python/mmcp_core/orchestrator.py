"""
MMCP Orchestrator — mirrors TypeScript src/index.ts MMCPOrchestrator.
Full async DAG execution with parallel dispatch, retry, and skip propagation.
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from .types import ContextEnvelope, Message, MMCPRunResult
from .context import create_context, build_history, topological_sort, parents_ready
from .store import MemoryStore
from .shared import SharedContextStore
from .observer import MMCPObserver
from .adapter import call_anthropic
from .operations import fork, merge, handoff, shard, verify


class MMCPOrchestrator:
    def __init__(self, config: dict) -> None:
        self.router = config["router"]
        self.store = config.get("store") or MemoryStore()
        self.shared = config.get("shared") or SharedContextStore()
        self.observer = config.get("observer") or MMCPObserver()
        self.timeout_ms = config.get("timeout_ms", 60000)
        self.regulation_tags = config.get("regulation_tags", [])
        self._call_model = config.get("adapter") or call_anthropic

    def root(
        self,
        task: str,
        role: str,
        model: str | None = None,
    ) -> ContextEnvelope:
        """Create a root context for a pipeline."""
        assignment = self.router.route(
            create_context(task=task, role=role, model=model or "")
        )
        return create_context(
            task=task,
            role=role,
            model=model or assignment.model_id,
            parent_ids=[],
            branch_type="root",
            history=[Message(role="user", content=task)],
            depth=0,
        )

    async def execute(
        self,
        contexts: list[ContextEnvelope],
    ) -> MMCPRunResult:
        """Execute a DAG of contexts with parallel dispatch."""
        start_time = datetime.now(timezone.utc)
        context_map = {c.id: c for c in contexts}

        # Validate DAG — detect cycles upfront
        topological_sort(contexts)

        # Save all contexts
        for ctx in contexts:
            await self.store.save(ctx)

        root_ids = [c.id for c in contexts if not c.parent_ids]
        self.observer.emit("mmcp.dag.started", {
            "root_ids": root_ids,
            "total_nodes": len(contexts),
        })

        failed_nodes: list[str] = []
        skipped_nodes: list[str] = []
        total_tokens = {"value": 0}
        total_cost = {"value": 0.0}

        await self._execute_dag(
            contexts, context_map,
            failed_nodes, skipped_nodes,
            total_tokens, total_cost,
        )

        # Collect leaf outputs
        leaf_outputs = [
            ctx.output
            for ctx in contexts
            if not ctx.children and ctx.output
        ]
        final_output = (
            leaf_outputs[0]
            if len(leaf_outputs) == 1
            else "\n\n---\n\n".join(leaf_outputs)
        )

        duration = int(
            (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
        )

        self.observer.emit("mmcp.dag.completed", {
            "total_nodes": len(contexts),
            "total_tokens": total_tokens["value"],
            "total_cost_usd": total_cost["value"],
            "duration_ms": duration,
            "failed": len(failed_nodes),
            "skipped": len(skipped_nodes),
        })

        return MMCPRunResult(
            output=final_output or "",
            dag=contexts,
            root_id=root_ids[0] if root_ids else "",
            total_nodes=len(contexts),
            total_tokens=total_tokens["value"],
            total_cost_usd=total_cost["value"],
            duration_ms=duration,
            success=len(failed_nodes) == 0,
            failed_nodes=failed_nodes,
            skipped_nodes=skipped_nodes,
            skill_report={},
        )

    async def _execute_dag(
        self,
        all_contexts: list[ContextEnvelope],
        context_map: dict[str, ContextEnvelope],
        failed_nodes: list[str],
        skipped_nodes: list[str],
        total_tokens: dict,
        total_cost: dict,
    ) -> None:
        pending = {c.id for c in all_contexts}
        running: set[str] = set()
        completed: set[str] = set()

        async def run_node(ctx: ContextEnvelope) -> None:
            pending.discard(ctx.id)
            running.add(ctx.id)

            # Build merge history at runtime
            if len(ctx.parent_ids) > 1 and not ctx.history:
                parents = await self.store.get_many(ctx.parent_ids)
                ctx.history = build_history(parents, ctx.task, ctx.role)
                await self.store.save(ctx)

            await self.store.update_status(ctx.id, "running")
            self.observer.emit(
                "mmcp.context.started",
                {"role": ctx.role, "model": ctx.model},
                ctx.id,
            )

            # Inject shared context into system prompt
            snapshot = self.shared.snapshot()
            assignment = self.router.route(ctx)
            if snapshot:
                assignment.system_prompt += (
                    f"\n\nSHARED CONTEXT (read-only snapshot):\n"
                    f"{snapshot}"
                )

            self.observer.emit(
                "mmcp.shared.read",
                {"key": "*", "author_ctx_id": ctx.id},
                ctx.id,
            )

            try:
                result = await asyncio.wait_for(
                    self._call_model(assignment, ctx),
                    timeout=self.timeout_ms / 1000,
                )

                total_tokens["value"] += result["tokens_used"]
                total_cost["value"] += result["cost_usd"]

                await self.store.update_status(
                    ctx.id,
                    "done",
                    result["output"],
                    extra={
                        "tokens_used": result["tokens_used"],
                        "input_tokens": result["input_tokens"],
                        "output_tokens": result["output_tokens"],
                        "cost_usd": result["cost_usd"],
                    },
                )
                ctx.status = "done"
                ctx.output = result["output"]
                ctx.tokens_used = result["tokens_used"]
                ctx.cost_usd = result["cost_usd"]
                context_map[ctx.id] = ctx

                # Write skill report if skills present
                required = ctx.required_skills or []
                matched = ctx.matched_skills or []
                missing = ctx.missing_skills or []
                if required:
                    self.shared.set(
                        f"skill_report:{ctx.id}",
                        {
                            "required": required,
                            "matched": matched,
                            "missing": missing,
                            "model": ctx.model,
                        },
                        ctx.id,
                        observer=self.observer,
                    )

                self.observer.emit(
                    "mmcp.context.completed",
                    {
                        "role": ctx.role,
                        "tokens": result["tokens_used"],
                        "cost_usd": result["cost_usd"],
                        "duration_ms": ctx.duration_ms,
                    },
                    ctx.id,
                )

            except Exception as e:
                error = str(e)
                if ctx.retry_count < ctx.max_retries:
                    ctx.retry_count += 1
                    ctx.status = "pending"
                    pending.add(ctx.id)
                    running.discard(ctx.id)
                    return

                await self.store.update_status(
                    ctx.id, "failed", extra={"error": error}
                )
                ctx.status = "failed"
                context_map[ctx.id] = ctx
                failed_nodes.append(ctx.id)

                # Propagate skipped to all downstream nodes
                downstream = self._get_downstream(ctx.id, all_contexts)
                for downstream_id in downstream:
                    down_ctx = context_map.get(downstream_id)
                    if down_ctx and down_ctx.status == "pending":
                        await self.store.update_status(
                            downstream_id,
                            "skipped",
                            extra={
                                "error": (
                                    f"Skipped: upstream {ctx.id} "
                                    f"({ctx.role}) failed"
                                )
                            },
                        )
                        down_ctx.status = "skipped"
                        context_map[downstream_id] = down_ctx
                        pending.discard(downstream_id)
                        skipped_nodes.append(downstream_id)

                self.observer.emit(
                    "mmcp.context.failed",
                    {"role": ctx.role, "error": error},
                    ctx.id,
                )

            running.discard(ctx.id)
            completed.add(ctx.id)

        # Main execution loop
        while pending or running:
            ready = [
                context_map[ctx_id]
                for ctx_id in list(pending)
                if parents_ready(context_map[ctx_id], context_map)
            ]

            if not ready and not running:
                # Deadlock
                for ctx_id in list(pending):
                    failed_nodes.append(ctx_id)
                    await self.store.update_status(
                        ctx_id,
                        "failed",
                        extra={"error": "Dependency deadlock"},
                    )
                    pending.discard(ctx_id)
                break

            if ready:
                await asyncio.gather(*[run_node(ctx) for ctx in ready])
            else:
                await asyncio.sleep(0.05)

    def _get_downstream(
        self,
        failed_id: str,
        all_contexts: list[ContextEnvelope],
    ) -> list[str]:
        """BFS to find all transitive descendants of a failed node."""
        downstream: list[str] = []
        queue = [failed_id]
        seen: set[str] = set()
        while queue:
            current = queue.pop(0)
            for ctx in all_contexts:
                if current in ctx.parent_ids and ctx.id not in seen:
                    seen.add(ctx.id)
                    downstream.append(ctx.id)
                    queue.append(ctx.id)
        return downstream

    # ── High-level convenience methods ────────────────────────────────────

    async def run_chain(
        self,
        task: str,
        roles: list[str],
    ) -> MMCPRunResult:
        """Execute a sequential chain of roles."""
        if not roles:
            raise ValueError("run_chain requires at least one role")
        contexts: list[ContextEnvelope] = []
        current = self.root(task, roles[0])
        contexts.append(current)
        for role in roles[1:]:
            current = handoff(current, {"role": role})
            contexts.append(current)
        return await self.execute(contexts)

    async def run_parallel(
        self,
        task: str,
        fork_roles: list[str],
        merge_role: str,
    ) -> MMCPRunResult:
        """Execute parallel fork → merge pipeline."""
        root_ctx = self.root(task, "orchestrator")
        forks = fork(root_ctx, [{"role": r} for r in fork_roles])
        merge_ctx = merge(forks, {"role": merge_role})
        return await self.execute([root_ctx, *forks, merge_ctx])

    async def run_verify(
        self,
        task: str,
        producer_role: str,
        challenger_role: str,
        synthesizer_role: str,
    ) -> MMCPRunResult:
        """Execute producer → challenger → synthesizer verification."""
        producer = self.root(task, producer_role)
        challenger_ctx, synthesizer_ctx = verify(
            producer,
            {"role": challenger_role},
            {"role": synthesizer_role},
        )
        return await self.execute([producer, challenger_ctx, synthesizer_ctx])

    async def run_sharded(
        self,
        task: str,
        shard_role: str,
        n: int,
        merge_role: str,
    ) -> MMCPRunResult:
        """Execute sharded pipeline with N shards → merge."""
        root_ctx = self.root(task, "orchestrator")
        shards = shard(root_ctx, n, shard_role)
        merge_ctx = merge(shards, {"role": merge_role})
        return await self.execute([root_ctx, *shards, merge_ctx])
