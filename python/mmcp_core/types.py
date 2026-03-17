"""
MMCP Core Types — mirrors TypeScript src/core/types.ts exactly.
Dataclasses + Literal types for full type safety.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional, Literal, Any

MMCP_VERSION = "1.0"

BranchType = Literal[
    "root", "fork", "merge", "handoff", "shard", "verify"
]

ContextStatus = Literal[
    "pending", "running", "done", "failed", "skipped"
]

MergeStrategy = Literal["union", "weighted", "voted"]
ShardStrategy = Literal["sequential", "semantic", "balanced"]


@dataclass
class Message:
    role: Literal["user", "assistant", "system"]
    content: str
    ctx_id: Optional[str] = None
    timestamp: Optional[str] = None


@dataclass
class ContextEnvelope:
    mmcp_version: str
    id: str
    parent_ids: list[str]
    children: list[str]
    task: str
    history: list[Message]
    model: str
    role: str
    branch_type: BranchType
    depth: int
    status: ContextStatus
    retry_count: int
    max_retries: int
    created_at: str
    metadata: dict[str, Any]
    system_prompt: Optional[str] = None
    shard_index: Optional[int] = None
    merge_strategy: Optional[MergeStrategy] = None
    confidence: Optional[float] = None
    required_skills: Optional[list[str]] = None
    matched_skills: Optional[list[str]] = None
    missing_skills: Optional[list[str]] = None
    skill_score: Optional[float] = None
    output: Optional[str] = None
    tokens_used: Optional[int] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    cost_usd: Optional[float] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_ms: Optional[int] = None
    error: Optional[str] = None


@dataclass
class ModelAssignment:
    model_id: str
    endpoint: str
    system_prompt: str
    max_tokens: int
    api_key: Optional[str] = None
    temperature: float = 0.7


@dataclass
class MMCPRunResult:
    output: str
    dag: list[ContextEnvelope]
    root_id: str
    total_nodes: int
    total_tokens: int
    total_cost_usd: float
    duration_ms: int
    success: bool
    failed_nodes: list[str]
    skipped_nodes: list[str]
    skill_report: dict[str, Any]
    wire_dag: Optional[dict] = None
    compliance_report: Optional[dict] = None
    cost_breakdown: Optional[dict] = None


# Event types
MMCPEventType = Literal[
    "mmcp.context.created",
    "mmcp.context.started",
    "mmcp.context.completed",
    "mmcp.context.failed",
    "mmcp.dag.started",
    "mmcp.dag.completed",
    "mmcp.shared.write",
    "mmcp.shared.read",
]


@dataclass
class MMCPEvent:
    type: MMCPEventType
    timestamp: str
    data: dict[str, Any]
    context_id: Optional[str] = None
