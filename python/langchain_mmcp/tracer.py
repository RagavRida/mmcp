"""
MMCP LangGraph/LangChain Tracer — THE KILLER FEATURE.
One line added to any LangGraph pipeline →
automatic MMCP WireDAG with full audit trail.

Usage:
    from langchain_mmcp import MMCPTracer
    
    tracer = MMCPTracer(
        regulation_tags=["SOC2", "GDPR"],
        export_path="./mmcp-audits/"
    )
    
    # LangGraph
    result = app.invoke(input, config={"callbacks": [tracer]})
    
    # LangChain
    chain.invoke(input, config={"callbacks": [tracer]})
    
    # Access audit trail
    wire_dag = tracer.get_wire_dag()
    tracer.export()
"""
from __future__ import annotations
import uuid
import json
import os
from datetime import datetime, timezone
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

from mmcp_core.context import create_context
from mmcp_core.wire import MMCPWireFormat


class MMCPTracer(BaseCallbackHandler):
    """LangGraph/LangChain callback that auto-produces MMCP WireDAG audit trails."""

    def __init__(
        self,
        regulation_tags: list[str] | None = None,
        export_path: str | None = None,
        auto_export: bool = True,
    ) -> None:
        self.regulation_tags = regulation_tags or []
        self.export_path = export_path
        self.auto_export = auto_export
        self._contexts: list = []
        self._active: dict[str, Any] = {}
        self._root_id: str | None = None
        self._dag_id = f"mmcp_dag_{uuid.uuid4().hex}"
        self._started_at = datetime.now(timezone.utc).isoformat()
        self._formatter = MMCPWireFormat()

    def on_chain_start(
        self,
        serialized: dict,
        inputs: dict,
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        task = str(inputs.get("input", inputs.get("messages", str(inputs))))
        parent_ids: list[str] = []
        if parent_run_id and str(parent_run_id) in self._active:
            parent_ids = [self._active[str(parent_run_id)].id]

        ctx = create_context(
            task=task[:500],
            role=serialized.get("id", ["unknown"])[-1],
            model="langchain",
            parent_ids=parent_ids,
            branch_type="root" if not parent_ids else "handoff",
            depth=len(parent_ids),
            metadata={
                "run_id": str(run_id),
                "serialized_id": serialized.get("id", []),
                "source": "langchain",
            },
        )
        ctx.status = "running"
        ctx.started_at = datetime.now(timezone.utc).isoformat()

        self._active[str(run_id)] = ctx
        self._contexts.append(ctx)
        if not self._root_id:
            self._root_id = ctx.id

    def on_chain_end(
        self,
        outputs: dict,
        *,
        run_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        ctx = self._active.get(str(run_id))
        if not ctx:
            return
        output = str(
            outputs.get("output", outputs.get("messages", str(outputs)))
        )
        ctx.status = "done"
        ctx.output = output[:1000]
        ctx.completed_at = datetime.now(timezone.utc).isoformat()
        if ctx.started_at:
            start = datetime.fromisoformat(ctx.started_at)
            end = datetime.fromisoformat(ctx.completed_at)
            ctx.duration_ms = int((end - start).total_seconds() * 1000)
        self._active.pop(str(run_id), None)

        if self.auto_export and not self._active:
            self.export()

    def on_chain_error(
        self,
        error: Exception,
        *,
        run_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        ctx = self._active.get(str(run_id))
        if not ctx:
            return
        ctx.status = "failed"
        ctx.error = str(error)
        ctx.completed_at = datetime.now(timezone.utc).isoformat()
        self._active.pop(str(run_id), None)

    def on_llm_start(
        self,
        serialized: dict,
        prompts: list[str],
        *,
        run_id: uuid.UUID,
        parent_run_id: uuid.UUID | None = None,
        **kwargs: Any,
    ) -> None:
        parent_ctx = (
            self._active.get(str(parent_run_id)) if parent_run_id else None
        )
        ctx = create_context(
            task=prompts[0][:500] if prompts else "LLM call",
            role="llm",
            model=serialized.get("kwargs", {}).get("model_name", "unknown"),
            parent_ids=[parent_ctx.id] if parent_ctx else [],
            branch_type="handoff",
            depth=(parent_ctx.depth + 1) if parent_ctx else 0,
            metadata={
                "run_id": str(run_id),
                "source": "langchain_llm",
            },
        )
        ctx.status = "running"
        ctx.started_at = datetime.now(timezone.utc).isoformat()
        self._active[str(run_id)] = ctx
        self._contexts.append(ctx)

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: uuid.UUID,
        **kwargs: Any,
    ) -> None:
        ctx = self._active.get(str(run_id))
        if not ctx:
            return
        output = (
            response.generations[0][0].text if response.generations else ""
        )
        ctx.status = "done"
        ctx.output = output[:1000]
        ctx.completed_at = datetime.now(timezone.utc).isoformat()

        if hasattr(response, "llm_output") and response.llm_output:
            usage = response.llm_output.get("token_usage", {})
            ctx.input_tokens = usage.get("prompt_tokens", 0)
            ctx.output_tokens = usage.get("completion_tokens", 0)
            ctx.tokens_used = (ctx.input_tokens or 0) + (ctx.output_tokens or 0)

        if ctx.started_at:
            start = datetime.fromisoformat(ctx.started_at)
            end = datetime.fromisoformat(ctx.completed_at)
            ctx.duration_ms = int((end - start).total_seconds() * 1000)

        self._active.pop(str(run_id), None)

    def get_contexts(self) -> list:
        return self._contexts

    def get_wire_dag(self) -> dict:
        return self._formatter.serialize_dag(
            self._contexts,
            dag_id=self._dag_id,
            regulation_tags=self.regulation_tags,
        )

    def export(self) -> str:
        wire_dag = self.get_wire_dag()
        if self.export_path:
            os.makedirs(self.export_path, exist_ok=True)
            filename = f"{self.export_path}/mmcp_audit_{self._dag_id}.json"
            with open(filename, "w") as f:
                json.dump(wire_dag, f, indent=2, default=str)
            print(f"[MMCP] Audit trail exported: {filename}")
            return filename
        return json.dumps(wire_dag, indent=2, default=str)

    def print_summary(self) -> None:
        total_tokens = sum(c.tokens_used or 0 for c in self._contexts)
        total_duration = sum(c.duration_ms or 0 for c in self._contexts)
        all_done = all(c.status == "done" for c in self._contexts)
        print("\n[MMCP Audit Summary]")
        print(f"  DAG ID:       {self._dag_id}")
        print(f"  Total nodes:  {len(self._contexts)}")
        print(f"  Total tokens: {total_tokens}")
        print(f"  Duration:     {total_duration}ms")
        print(
            f"  Regulations:  "
            f"{', '.join(self.regulation_tags) or 'none'}"
        )
        print(f"  Status:       {'✅ all done' if all_done else '⚠️ some failed'}")
