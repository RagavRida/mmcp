"""
MMCP Core — Multiple Model Context Protocol Python SDK
"""
from .types import (
    ContextEnvelope, Message, ModelAssignment, MMCPRunResult,
    MMCPEvent, BranchType, ContextStatus, MergeStrategy,
    ShardStrategy, MMCP_VERSION, MMCPEventType,
    # v2.2 Intelligence types
    TaskComplexity, ToolTier, ModelJustification, SmartRouteDecision,
    MCPCallMetrics, ToolMatch, ExpenseEntry, SavingsRecommendation,
    SpendAnalysis, BudgetStatus,
)
from .context import (
    create_context, build_history,
    topological_sort, parents_ready,
)
from .operations import fork, merge, handoff, shard, verify
from .store import MemoryStore
from .shared import SharedContextStore, SharedContextEntry
from .router import RoleBasedRouter
from .adapter import call_anthropic, calculate_cost, MODEL_PRICING
from .observer import MMCPObserver
from .wire import MMCPWireFormat
from .orchestrator import MMCPOrchestrator
# v2.2 Intelligence modules
from .config import MMCPConfig, get_config, set_config
from .complexity_analyzer import analyze_complexity, detect_domain, ComplexityResult
from .smart_router import SmartRouter
from .tool_selector import (
    select_tools, resolve_tool, build_tool_context,
    MCPConnectionPool,
)
from .cost_optimizer import CostOptimizer

__version__ = "2.2.0"
__all__ = [
    "MMCPOrchestrator", "MMCPObserver", "MMCPWireFormat",
    "MemoryStore", "SharedContextStore", "SharedContextEntry",
    "RoleBasedRouter",
    "fork", "merge", "handoff", "shard", "verify",
    "create_context", "build_history", "topological_sort", "parents_ready",
    "call_anthropic", "calculate_cost", "MODEL_PRICING",
    "ContextEnvelope", "Message", "ModelAssignment", "MMCPRunResult",
    "MMCPEvent", "MMCPEventType",
    "BranchType", "ContextStatus", "MergeStrategy", "ShardStrategy",
    "MMCP_VERSION",
    # v2.2 Intelligence
    "MMCPConfig", "get_config", "set_config",
    "TaskComplexity", "ToolTier", "ModelJustification", "SmartRouteDecision",
    "MCPCallMetrics", "ToolMatch", "ExpenseEntry", "SavingsRecommendation",
    "SpendAnalysis", "BudgetStatus",
    "analyze_complexity", "detect_domain", "ComplexityResult",
    "SmartRouter",
    "select_tools", "resolve_tool", "build_tool_context",
    "MCPConnectionPool",
    "CostOptimizer",
]

