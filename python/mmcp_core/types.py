"""
MMCP Core Types — mirrors TypeScript src/core/types.ts exactly.
Dataclasses + Literal types for full type safety.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
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


# ── Intelligence Types (v2.2) ──────────────────────────────────────────────


class TaskComplexity(Enum):
    """Task complexity tiers for model routing decisions."""
    TRIVIAL = "trivial"      # Simple lookups, formatting, translation
    STANDARD = "standard"    # Writing, summarization, basic analysis
    COMPLEX = "complex"      # Multi-step reasoning, code generation, architecture
    FRONTIER = "frontier"    # Research-grade reasoning, math proofs, security audits


class ToolTier(Enum):
    """Cost tier for tool routing decisions."""
    BUILTIN = "builtin"       # Free, instant — always prefer
    MCP_WARM = "mcp_warm"     # Already-connected MCP — cheap, fast
    MCP_COLD = "mcp_cold"     # Needs new connection — expensive startup
    LLM_TOOL = "llm_tool"    # Use a cheap LLM as a tool — token cost


@dataclass
class ModelJustification:
    """Explains why a specific model was chosen for a task."""
    task_complexity: TaskComplexity
    chosen_model: str
    domain: str
    reasoning: str              # Human-readable explanation
    estimated_cost: float       # Projected cost for this step
    alternative_model: str      # Cheaper alternative if user wants savings
    alternative_cost: float     # Cost with the alternative
    savings_percent: float      # How much they'd save
    quality_risk: str           # What they might lose


@dataclass
class SmartRouteDecision:
    """Full routing decision with justification."""
    model: str
    endpoint: str
    domain: str
    complexity: TaskComplexity
    justification: ModelJustification
    budget_constrained: bool = False  # True if downgraded due to budget


@dataclass
class MCPCallMetrics:
    """Performance metrics for a single MCP tool call."""
    server_name: str
    tool_name: str
    startup_ms: int              # 0 if connection was reused
    call_latency_ms: int
    was_pool_hit: bool           # True if connection was reused
    builtin_equivalent: str | None = None  # If a built-in could have done this


@dataclass
class ToolMatch:
    """A tool matched to a task intent."""
    tool_name: str
    source: str                  # "builtin" | "mcp:server_name"
    tier: ToolTier
    relevance_score: float       # 0.0-1.0 how well it matches the task
    cost_per_call: float         # Estimated cost
    avg_latency_ms: int
    tags: list[str] = field(default_factory=list)


@dataclass
class ExpenseEntry:
    """A single entry in the expense ledger."""
    timestamp: str
    task_summary: str
    entry_type: str              # "model_call" | "mcp_tool" | "builtin_tool"
    model: str | None = None
    mcp_server: str | None = None
    tool_name: str | None = None
    domain: str = "general"
    complexity: str = "standard"
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    overhead_ms: int = 0
    success: bool = True
    latency_ms: int = 0
    was_justified: bool = True
    builtin_available: bool = False


@dataclass
class SavingsRecommendation:
    """An actionable cost-saving recommendation."""
    category: str               # "downgrade" | "mcp_to_builtin" | "mcp_reuse" | "cache" | "model_waste"
    title: str
    description: str
    estimated_savings_usd: float
    estimated_savings_time_ms: int
    confidence: float           # 0.0-1.0 how confident we are in this recommendation
    affected_count: int         # How many calls this affects


@dataclass
class SpendAnalysis:
    """Aggregate spending analysis."""
    period_days: int
    total_cost_usd: float
    total_calls: int
    total_tokens: int
    by_model: dict[str, float]         # model -> total cost
    by_domain: dict[str, float]        # domain -> total cost
    by_complexity: dict[str, float]    # complexity -> total cost
    mcp_overhead_total_ms: int
    mcp_calls_total: int
    builtin_calls_total: int
    top_waste: list[SavingsRecommendation] = field(default_factory=list)


@dataclass
class BudgetStatus:
    """Current budget tracking status."""
    daily_budget_usd: float
    spent_today_usd: float
    remaining_usd: float
    projected_daily_usd: float
    is_over_budget: bool
    downgrade_active: bool     # True if models are being downgraded due to budget

