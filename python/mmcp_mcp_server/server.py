"""
MMCP MCP Server — mmcp-core

An MCP server that exposes MMCP's intelligent multi-model routing,
cost optimization, and autonomous pipeline capabilities as tools
for Claude Desktop, Codex CLI, and any MCP-compatible client.

Tools exposed:
  - analyze_task       → Classify complexity + detect domain + recommend model
  - plan_task          → Decompose task into executable steps with model justifications
  - execute_task       → Full autonomous pipeline (plan → execute → result)
  - select_tools       → Auto-discover the best tools for a task
  - cost_summary       → Spending summary over a period
  - cost_savings       → Actionable savings recommendations
  - set_budget         → Set daily spend cap
  - model_value_report → Which models create value vs. which are overkill
  - list_skills        → List saved reusable pipeline skills
  - configure          → View/update MMCP configuration

Usage:
  # stdio (for Claude Desktop / Codex CLI)
  python -m mmcp_mcp_server

  # Or via the entry point
  mmcp-mcp-server
"""
from __future__ import annotations

import json
import logging
import os
import sys

from mcp.server.fastmcp import FastMCP

# ── Logging to stderr (stdout is reserved for MCP JSON-RPC) ─────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [mmcp-mcp] %(levelname)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("mmcp-mcp-server")


# ── Server Instance ─────────────────────────────────────────────────────────

mcp = FastMCP(
    "mmcp-core",
    instructions=(
        "MMCP — Multi-Model Context Protocol v2.2. "
        "Intelligent routing across Claude, GPT, Gemini, DeepSeek, Llama. "
        "Auto-selects models by task complexity, tracks costs, optimizes spend."
    ),
)


# ── Lazy Imports (avoid heavy startup) ──────────────────────────────────────

def _get_config():
    from mmcp_core.config import get_config
    return get_config()


def _get_smart_router():
    from mmcp_core.smart_router import SmartRouter
    return SmartRouter()


def _get_cost_optimizer():
    from mmcp_core.cost_optimizer import CostOptimizer
    return CostOptimizer()


# ── Tool: analyze_task ──────────────────────────────────────────────────────

@mcp.tool()
def analyze_task(task: str) -> str:
    """Analyze a task's complexity, domain, and optimal model tier.

    Given a task description, returns:
    - Complexity tier (TRIVIAL/STANDARD/COMPLEX/FRONTIER)
    - Detected domain (code, math, creative, etc.)
    - Recommended model with justification
    - Alternative cheaper model with savings percentage
    - Estimated output tokens

    Use this before executing a task to understand its requirements
    and which AI model provides the best value.

    Args:
        task: The task description to analyze (e.g., "prove the Riemann hypothesis")
    """
    from mmcp_core.complexity_analyzer import analyze_complexity
    router = _get_smart_router()

    # Complexity analysis
    analysis = analyze_complexity(task)

    # Model routing decision
    decision = router.route(task)
    j = decision.justification

    result = {
        "complexity": analysis.complexity.value,
        "domain": analysis.domain,
        "confidence": analysis.confidence,
        "signals_found": analysis.signals_found[:5],
        "reasoning": analysis.reasoning,
        "estimated_output_tokens": analysis.estimated_tokens,
        "recommended_model": {
            "model": j.chosen_model,
            "estimated_cost": f"${j.estimated_cost:.6f}",
            "reasoning": j.reasoning,
        },
        "cheaper_alternative": {
            "model": j.alternative_model,
            "estimated_cost": f"${j.alternative_cost:.6f}",
            "savings_percent": f"{j.savings_percent:.0f}%",
            "quality_risk": j.quality_risk,
        },
        "budget_constrained": decision.budget_constrained,
    }

    return json.dumps(result, indent=2)


# ── Tool: plan_task ─────────────────────────────────────────────────────────

@mcp.tool()
async def plan_task(
    task: str,
    auto_select_models: bool = True,
) -> str:
    """Create an execution plan for a complex task.

    Decomposes the task into 3-6 executable steps, each with:
    - The optimal AI model (auto-selected by complexity)
    - Model justification (why this model, not a cheaper one)
    - Tool requirements (web search, file ops, etc.)
    - Dependency chain (which steps feed into which)

    Args:
        task: The task to plan (e.g., "Research AI trends and write a blog post")
        auto_select_models: If True, SmartRouter picks models per step (default: True)
    """
    from mmcp_core.planner import plan_task as _plan_task

    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        return json.dumps({
            "error": "OPENROUTER_API_KEY not set",
            "fix": "Set the OPENROUTER_API_KEY environment variable",
        })

    router = _get_smart_router() if auto_select_models else None

    try:
        plan = await _plan_task(task, api_key=api_key, smart_router=router)
    except Exception as e:
        return json.dumps({"error": f"Planning failed: {str(e)}"})

    steps = []
    for s in plan.steps:
        step_data = {
            "step": s.step,
            "action": s.action,
            "description": s.description,
            "model": s.resolve_model(),
            "tool_name": s.tool_name,
            "depends_on": s.depends_on,
        }
        if s.justification:
            j = s.justification
            step_data["justification"] = {
                "complexity": j.task_complexity.value,
                "domain": j.domain,
                "reasoning": j.reasoning,
                "estimated_cost": f"${j.estimated_cost:.6f}",
                "alternative": f"{j.alternative_model} (save {j.savings_percent:.0f}%)",
            }
        steps.append(step_data)

    return json.dumps({
        "task": task,
        "total_steps": len(steps),
        "steps": steps,
        "display": plan.to_display(),
    }, indent=2)


# ── Tool: execute_task ──────────────────────────────────────────────────────

@mcp.tool()
async def execute_task(
    task: str,
    auto_approve: bool = False,
) -> str:
    """Execute a task end-to-end: plan → route models → execute → return results.

    This is the full autonomous pipeline. It will:
    1. Analyze the task complexity
    2. Create an execution plan (3-6 steps)
    3. Auto-select the optimal model for each step
    4. Execute each step in order (respecting dependencies)
    5. Track costs and return the final output

    Args:
        task: The task to execute (e.g., "Summarize the latest AI papers")
        auto_approve: If True, executes without confirmation (default: False)
    """
    from mmcp_core.planner import plan_task as _plan_task
    from mmcp_core.executor import execute_plan

    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        return json.dumps({
            "error": "OPENROUTER_API_KEY not set",
            "fix": "Set the OPENROUTER_API_KEY environment variable",
        })

    router = _get_smart_router()
    optimizer = _get_cost_optimizer()

    try:
        # Plan
        plan = await _plan_task(task, api_key=api_key, smart_router=router)

        if not auto_approve:
            # Return plan for review instead of executing
            return json.dumps({
                "status": "plan_ready",
                "message": "Plan created. Call execute_task with auto_approve=True to run it.",
                "plan": plan.to_display(),
                "steps": len(plan.steps),
            }, indent=2)

        # Execute
        result = await execute_plan(
            plan, api_key=api_key,
            smart_router=router,
            cost_optimizer=optimizer,
        )

        # Extract final output
        final_output = None
        for step in reversed(result.steps):
            if step.status == "done" and step.output:
                final_output = step.output
                break

        return json.dumps({
            "status": result.status,
            "steps_completed": len([s for s in result.steps if s.status == "done"]),
            "total_steps": len(result.steps),
            "tokens_used": result.context.get("_total_tokens", 0),
            "cost_usd": f"${result.context.get('_total_cost', 0):.6f}",
            "output": final_output,
        }, indent=2)

    except Exception as e:
        logger.error(f"Execute failed: {e}", exc_info=True)
        return json.dumps({"error": f"Execution failed: {str(e)}"})


# ── Tool: select_tools ─────────────────────────────────────────────────────

@mcp.tool()
def select_tools_for_task(task: str, max_tools: int = 5) -> str:
    """Discover the best tools for a given task.

    Analyzes the task and returns ranked tools, preferring free built-in
    tools over expensive MCP server tools.

    Returns tools with: name, type (builtin/MCP), relevance score,
    cost per call, and average latency.

    Args:
        task: The task description (e.g., "search the web for Python tutorials")
        max_tools: Maximum number of tools to return (default: 5)
    """
    from mmcp_core.tool_selector import select_tools

    matches = select_tools(task, max_tools=max_tools)

    tools = []
    for m in matches:
        tools.append({
            "name": m.tool_name,
            "source": m.source,
            "tier": m.tier.value,
            "relevance_score": m.relevance_score,
            "cost_per_call": m.cost_per_call,
            "avg_latency_ms": m.avg_latency_ms,
            "matching_tags": m.tags,
        })

    return json.dumps({
        "task": task,
        "tools_found": len(tools),
        "tools": tools,
        "tip": "Prefer 'builtin' tools (free, instant) over 'mcp' tools (startup overhead)",
    }, indent=2)


# ── Tool: cost_summary ─────────────────────────────────────────────────────

@mcp.tool()
def cost_summary(period_days: int = 30) -> str:
    """Get a summary of AI spending over a time period.

    Shows total cost, token usage, cost by model, MCP overhead,
    and top savings opportunities.

    Args:
        period_days: Number of days to analyze (default: 30)
    """
    optimizer = _get_cost_optimizer()
    analysis = optimizer.analyze_spend(period_days)

    return json.dumps({
        "period_days": analysis.period_days,
        "total_cost_usd": f"${analysis.total_cost_usd:.4f}",
        "total_calls": analysis.total_calls,
        "total_tokens": analysis.total_tokens,
        "by_model": {
            model.split("/")[-1]: f"${cost:.4f}"
            for model, cost in sorted(analysis.by_model.items(), key=lambda x: -x[1])
        },
        "mcp_overhead_ms": analysis.mcp_overhead_total_ms,
        "mcp_calls": analysis.mcp_calls_total,
        "builtin_calls": analysis.builtin_calls_total,
        "top_savings": [
            {"title": r.title, "savings": f"${r.estimated_savings_usd:.4f}"}
            for r in (analysis.top_waste or [])[:3]
        ],
    }, indent=2)


# ── Tool: cost_savings ──────────────────────────────────────────────────────

@mcp.tool()
def cost_savings() -> str:
    """Get actionable recommendations to reduce AI spending.

    Analyzes historical usage patterns and identifies:
    - Premium models used for trivial tasks (waste)
    - MCP tools that have free built-in equivalents
    - MCP servers that need connection pooling
    - Models used below their capability threshold

    Returns ranked recommendations with estimated savings.
    """
    optimizer = _get_cost_optimizer()
    recs = optimizer.get_savings_recommendations()

    if not recs:
        return json.dumps({
            "status": "optimized",
            "message": "No savings found — you're running efficiently!",
        })

    recommendations = []
    for r in recs:
        rec = {
            "category": r.category,
            "title": r.title,
            "description": r.description,
            "confidence": f"{r.confidence:.0%}",
            "affected_count": r.affected_count,
        }
        if r.estimated_savings_usd > 0:
            rec["estimated_savings_usd"] = f"${r.estimated_savings_usd:.4f}"
        if r.estimated_savings_time_ms > 0:
            rec["estimated_savings_time_ms"] = r.estimated_savings_time_ms
        recommendations.append(rec)

    return json.dumps({
        "recommendations_count": len(recommendations),
        "recommendations": recommendations,
    }, indent=2)


# ── Tool: set_budget ────────────────────────────────────────────────────────

@mcp.tool()
def set_budget(daily_usd: float) -> str:
    """Set a daily spending cap for AI model usage.

    When approaching the limit, models are automatically downgraded to
    cheaper alternatives to stay within budget.

    Args:
        daily_usd: Daily budget in USD (e.g., 1.0 for $1/day)
    """
    optimizer = _get_cost_optimizer()
    optimizer.set_budget(daily_usd)

    status = optimizer.get_budget_status()

    return json.dumps({
        "status": "budget_set",
        "daily_budget_usd": f"${daily_usd:.2f}",
        "spent_today_usd": f"${status.spent_today_usd:.4f}",
        "remaining_usd": f"${status.remaining_usd:.4f}",
        "is_over_budget": status.is_over_budget,
        "message": f"Daily budget set to ${daily_usd:.2f}. Models will auto-downgrade when approaching limit.",
    }, indent=2)


# ── Tool: model_value_report ────────────────────────────────────────────────

@mcp.tool()
def model_value_report() -> str:
    """Get a value analysis of all AI models used.

    Shows for each model:
    - Total calls and cost
    - Success rate
    - Value score (success × justification)
    - Usage by task complexity tier
    - Whether premium models are being wasted on simple tasks
    """
    optimizer = _get_cost_optimizer()
    report = optimizer.get_model_value_report()

    if not report:
        return json.dumps({
            "status": "no_data",
            "message": "No model usage data yet. Run some tasks first.",
        })

    models = {}
    for model, data in sorted(report.items(), key=lambda x: -x[1]["value_score"]):
        models[model.split("/")[-1]] = {
            "total_calls": data["total_calls"],
            "total_cost": f"${data['total_cost']:.4f}",
            "success_rate": f"{data['success_rate']:.0%}",
            "value_score": data["value_score"],
            "justified_pct": f"{data.get('justified_pct', 0):.0f}%",
            "by_complexity": data.get("by_complexity", {}),
        }

    return json.dumps({"models": models}, indent=2)


# ── Tool: list_skills ──────────────────────────────────────────────────────

@mcp.tool()
def list_skills() -> str:
    """List all saved reusable pipeline skills.

    Skills are previously-executed pipelines that were saved for reuse.
    They can be applied to similar tasks without re-planning.
    """
    from mmcp_core.skill_engine import list_skills as _list_skills

    skills = _list_skills()

    if not skills:
        return json.dumps({
            "status": "empty",
            "message": "No saved skills. Run execute_task and save the pipeline as a skill.",
        })

    return json.dumps({
        "skills_count": len(skills),
        "skills": [
            {"name": s["name"], "steps": s["steps"], "task": s["task"][:100]}
            for s in skills
        ],
    }, indent=2)


# ── Tool: configure ─────────────────────────────────────────────────────────

@mcp.tool()
def configure(
    action: str = "view",
    key: str = "",
    value: str = "",
) -> str:
    """View or update MMCP configuration.

    MMCP is fully configurable — models, pricing, routing parameters,
    token limits, and tool registrations can all be customized.

    Actions:
    - "view": Show current configuration summary
    - "models": List all known models with pricing
    - "tools": List all registered tools
    - "routing": Show routing parameters
    - "tokens": Show token optimization settings

    Args:
        action: What to show — "view", "models", "tools", "routing", "tokens"
        key: (unused for now, reserved for future set operations)
        value: (unused for now, reserved for future set operations)
    """
    cfg = _get_config()

    if action == "models":
        models = {}
        for model, pricing in sorted(cfg.model_pricing.items()):
            models[model] = {
                "input_per_1m": f"${pricing['input']:.2f}",
                "output_per_1m": f"${pricing['output']:.2f}",
            }
        return json.dumps({"models": models}, indent=2)

    elif action == "tools":
        tools = {}
        for name, spec in cfg.builtin_tools.items():
            tools[name] = {
                "description": spec.get("description", ""),
                "cost": f"${spec.get('cost_per_call', 0):.4f}",
                "latency_ms": spec.get("avg_latency_ms", 0),
            }
        return json.dumps({
            "builtin_tools": tools,
            "mcp_to_builtin_map": cfg.mcp_to_builtin,
            "mcp_servers": list(cfg.mcp_servers.keys()),
        }, indent=2)

    elif action == "routing":
        return json.dumps({
            "default_model": cfg.default_model,
            "planner_model": cfg.planner_model,
            "epsilon": cfg.epsilon,
            "weights": cfg.routing_weights,
            "daily_budget": cfg.daily_budget_usd,
        }, indent=2)

    elif action == "tokens":
        return json.dumps({
            "max_context_injection_tokens": cfg.max_context_injection_tokens,
            "max_output_tokens_per_step": cfg.max_output_tokens_per_step,
            "max_plan_steps": cfg.max_plan_steps,
            "truncation_strategy": cfg.truncation_strategy,
            "compact_system_prompts": cfg.compact_system_prompts,
            "token_estimate_ratio": cfg.token_estimate_ratio,
        }, indent=2)

    else:  # "view" — summary
        return json.dumps(cfg.to_dict(), indent=2)


# ── Resource: config file path ──────────────────────────────────────────────

@mcp.resource("mmcp://config")
def get_config_resource() -> str:
    """Current MMCP configuration as a resource."""
    cfg = _get_config()
    return json.dumps(cfg.to_dict(), indent=2)


@mcp.resource("mmcp://pricing")
def get_pricing_resource() -> str:
    """Model pricing table as a resource."""
    cfg = _get_config()
    return json.dumps(cfg.model_pricing, indent=2)


# ── Server Entry Point ─────────────────────────────────────────────────────

def main():
    """Run the MMCP MCP server over stdio."""
    logger.info("Starting mmcp-core MCP server v2.2.0")
    logger.info("Tools: analyze_task, plan_task, execute_task, select_tools_for_task, "
                "cost_summary, cost_savings, set_budget, model_value_report, "
                "list_skills, configure")
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
