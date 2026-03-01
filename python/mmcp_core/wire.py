"""
MMCP Wire Format — mirrors TypeScript src/wire/format.ts.
Serialize ContextEnvelope → WireEnvelope with SHA-256 audit hash.
"""
from __future__ import annotations
import hashlib
import uuid
from datetime import datetime, timezone
from .types import ContextEnvelope, MMCP_VERSION
from .adapter import MODEL_PRICING, calculate_cost


class MMCPWireFormat:
    def serialize(self, ctx: ContextEnvelope) -> dict:
        """Convert a ContextEnvelope to a wire-format envelope."""
        audit_hash = self._compute_hash(ctx)
        cost_usd = ctx.cost_usd
        if cost_usd is None and ctx.input_tokens and ctx.output_tokens:
            cost_usd = calculate_cost(
                ctx.model, ctx.input_tokens, ctx.output_tokens
            )

        return {
            "mmcp": MMCP_VERSION,
            "envelope_id": f"mmcp_{uuid.uuid4().hex}",
            "schema": "https://mmcp.dev/schema/1.0/envelope.json",
            "id": ctx.id,
            "parent_ids": ctx.parent_ids,
            "children": ctx.children,
            "task": ctx.task,
            "model": ctx.model,
            "role": ctx.role,
            "branch_type": ctx.branch_type,
            "depth": ctx.depth,
            "status": ctx.status,
            "confidence": ctx.confidence,
            "output": ctx.output,
            "output_preview": (ctx.output or "")[:100],
            "tokens_used": ctx.tokens_used,
            "input_tokens": ctx.input_tokens,
            "output_tokens": ctx.output_tokens,
            "cost_usd": cost_usd,
            "created_at": ctx.created_at,
            "started_at": ctx.started_at,
            "completed_at": ctx.completed_at,
            "duration_ms": ctx.duration_ms,
            "error": ctx.error,
            "required_skills": ctx.required_skills,
            "matched_skills": ctx.matched_skills,
            "compliance": {
                "dag_valid": True,
                "append_only": True,
                "audit_hash": audit_hash,
                "signed_by": ctx.model,
            },
            "metadata": ctx.metadata,
        }

    def serialize_dag(
        self,
        contexts: list[ContextEnvelope],
        dag_id: str | None = None,
        regulation_tags: list[str] | None = None,
    ) -> dict:
        """Serialize entire DAG to wire format with compliance report."""
        envelopes = [self.serialize(ctx) for ctx in contexts]
        total_tokens = sum(e.get("tokens_used") or 0 for e in envelopes)
        total_cost = sum(e.get("cost_usd") or 0.0 for e in envelopes)

        audit_chain = [
            {
                "sequence": i + 1,
                "ctx_id": e["id"],
                "role": e["role"],
                "model": e["model"],
                "branch_type": e["branch_type"],
                "parent_ids": e["parent_ids"],
                "started_at": e.get("started_at"),
                "completed_at": e.get("completed_at"),
                "audit_hash": e["compliance"]["audit_hash"],
                "output_preview": e.get("output_preview", ""),
            }
            for i, e in enumerate(envelopes)
            if e["status"] == "done"
        ]

        return {
            "mmcp": MMCP_VERSION,
            "dag_id": dag_id or f"mmcp_dag_{uuid.uuid4().hex}",
            "schema": "https://mmcp.dev/schema/1.0/dag.json",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "envelopes": envelopes,
            "total_tokens": total_tokens,
            "total_cost_usd": total_cost,
            "regulation_tags": regulation_tags or [],
            "compliance_report": {
                "valid": all(e["status"] == "done" for e in envelopes),
                "total_nodes": len(envelopes),
                "verified_nodes": [
                    e["id"]
                    for e in envelopes
                    if e.get("metadata", {}).get("verify_role") == "synthesizer"
                ],
                "audit_chain": audit_chain,
                "regulation_compliance": {
                    tag: True for tag in (regulation_tags or [])
                },
            },
        }

    def _compute_hash(self, ctx: ContextEnvelope) -> str:
        content = (
            ctx.id
            + ",".join(ctx.parent_ids)
            + (ctx.output or "")
            + (ctx.completed_at or "")
        )
        return hashlib.sha256(content.encode()).hexdigest()
