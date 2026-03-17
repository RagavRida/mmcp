"""Interactive run command with smart routing."""
from __future__ import annotations
import argparse
import asyncio
import json
import os
from datetime import datetime

from ._common import (
    _resolve_model, _banner, _load_env, _print_result,
    _make_orchestrator, _status_icon,
    BOLD, DIM, GREEN, YELLOW, RED, CYAN, RESET,
)
from ..wire import MMCPWireFormat


# ── Keyword patterns for task classification ────────────────────────────────

_COMPLEXITY_HIGH = [
    "research", "analyze", "compare", "evaluate", "design", "architect",
    "security", "audit", "compliance", "legal", "review", "strategy",
    "thesis", "dissertation", "whitepaper", "scientific", "prove",
    "mathematics", "algorithm", "optimize", "refactor",
]
_COMPLEXITY_MEDIUM = [
    "explain", "describe", "write", "create", "generate", "draft",
    "plan", "outline", "summarize", "blog", "article", "report",
    "email", "document", "proposal", "recommend", "suggest",
]
_PATTERN_DEBATE = [
    "pros and cons", "argue", "debate", "controversial", "opinion",
    "is it better", "should we", "versus", "vs", "compare",
    "agree or disagree", "evaluate", "critique",
]
_PATTERN_MULTIVIEW = [
    "multiple perspectives", "different angles", "brainstorm",
    "creative ideas", "alternatives", "options", "approaches",
    "from different", "various viewpoints",
]
_PATTERN_SHARD = [
    "long document", "entire book", "full report", "comprehensive",
    "all aspects", "thorough", "deep dive", "detailed analysis",
    "extensive", "complete overview", "in-depth",
]


def _smart_route(task: str) -> dict:
    """Analyze the task and auto-select the best pattern + model."""
    task_lower = task.lower()
    words = task_lower.split()
    word_count = len(words)

    or_key = os.environ.get("OPENROUTER_API_KEY", "")
    use_or = bool(or_key)

    # Complexity scoring
    high_hits = sum(1 for kw in _COMPLEXITY_HIGH if kw in task_lower)
    med_hits = sum(1 for kw in _COMPLEXITY_MEDIUM if kw in task_lower)

    if high_hits >= 2 or word_count > 50:
        complexity = "high"
    elif high_hits >= 1 or med_hits >= 2 or word_count > 25:
        complexity = "medium"
    else:
        complexity = "low"

    # Task-type detection
    _CODING_KW = ["code", "program", "function", "debug", "api", "script",
                  "python", "javascript", "typescript", "rust", "sql", "html",
                  "css", "react", "deploy", "docker", "git", "refactor", "bug"]
    _CREATIVE_KW = ["write", "story", "poem", "blog", "creative", "essay",
                    "narrative", "fiction", "article", "content", "copy",
                    "marketing", "brand", "slogan", "tagline"]
    _MATH_KW = ["math", "calculate", "equation", "proof", "theorem",
                "statistics", "probability", "algebra", "calculus",
                "optimization", "numerical", "formula"]
    _REASONING_KW = ["research", "analyze", "evaluate", "strategy", "design",
                     "architecture", "security", "legal", "compliance",
                     "scientific", "thesis", "philosophy"]
    _FAST_KW = ["quick", "short", "simple", "brief", "summarize", "translate",
                "list", "define", "one word", "yes or no", "haiku"]

    coding_hits = sum(1 for kw in _CODING_KW if kw in task_lower)
    creative_hits = sum(1 for kw in _CREATIVE_KW if kw in task_lower)
    math_hits = sum(1 for kw in _MATH_KW if kw in task_lower)
    reasoning_hits = sum(1 for kw in _REASONING_KW if kw in task_lower)
    fast_hits = sum(1 for kw in _FAST_KW if kw in task_lower)

    # Model selection (multi-provider via OpenRouter)
    if use_or:
        if coding_hits >= 2:
            model = "google/gemini-2.5-pro-preview"
            model_name = "Gemini 2.5 Pro"
            model_reason = "Top-tier for coding tasks"
        elif coding_hits >= 1:
            model = "openai/gpt-4o"
            model_name = "GPT-4o"
            model_reason = "Strong at code generation"
        elif math_hits >= 2:
            model = "deepseek/deepseek-r1"
            model_name = "DeepSeek R1"
            model_reason = "Best for math & reasoning"
        elif creative_hits >= 2:
            model = "anthropic/claude-sonnet-4"
            model_name = "Claude Sonnet"
            model_reason = "Excellent creative writing"
        elif reasoning_hits >= 2 or complexity == "high":
            model = "anthropic/claude-sonnet-4"
            model_name = "Claude Sonnet"
            model_reason = "Deep reasoning & analysis"
        elif fast_hits >= 1 or complexity == "low":
            model = "meta-llama/llama-4-maverick"
            model_name = "Llama 4 Maverick"
            model_reason = "Fast & free for quick tasks"
        elif complexity == "medium":
            model = "anthropic/claude-3.5-haiku"
            model_name = "Claude Haiku"
            model_reason = "Good all-rounder"
        else:
            model = "anthropic/claude-3.5-haiku"
            model_name = "Claude Haiku"
            model_reason = "Fast & efficient"
    else:
        if complexity == "high":
            model = "claude-sonnet-4-20250514"
            model_name = "Claude Sonnet"
            model_reason = "Complex task needs strong reasoning"
        else:
            model = "claude-haiku-4-5-20251001"
            model_name = "Claude Haiku"
            model_reason = "Fast & efficient"

    # Pattern selection
    debate_hits = sum(1 for kw in _PATTERN_DEBATE if kw in task_lower)
    multi_hits = sum(1 for kw in _PATTERN_MULTIVIEW if kw in task_lower)
    shard_hits = sum(1 for kw in _PATTERN_SHARD if kw in task_lower)

    if debate_hits >= 1:
        pipeline_type = "verify"
        pattern_name = "⚖️  Debate"
        pattern_reason = "Task involves comparison or evaluation"
        roles = ["expert", "challenger", "synthesizer"]
        roles_display = "expert → challenger → synthesizer"
    elif multi_hits >= 1 or (high_hits >= 2 and "?" in task):
        pipeline_type = "parallel"
        pattern_name = "🔀 Multi-view"
        pattern_reason = "Benefits from multiple perspectives"
        roles = ["analyst", "creative", "critic", "synthesizer"]
        roles_display = "[analyst, creative, critic] → synthesizer"
    elif shard_hits >= 1 or word_count > 40:
        pipeline_type = "shard"
        pattern_name = "📊 Deep dive"
        pattern_reason = "Complex topic needs thorough coverage"
        n = 3 if complexity != "high" else 4
        roles = ["analyst", "editor"]
        roles_display = f"analyst ×{n} → editor"
    else:
        pipeline_type = "chain"
        pattern_name = "✍️  Simple"
        pattern_reason = "Clean write → review flow"
        roles = ["writer", "reviewer"]
        roles_display = "writer → reviewer"

    result = {
        "complexity": complexity,
        "pipeline_type": pipeline_type,
        "pattern_name": pattern_name,
        "pattern_reason": pattern_reason,
        "model": model,
        "model_name": model_name,
        "model_reason": model_reason,
        "roles": roles,
        "roles_display": roles_display,
    }
    if pipeline_type == "shard":
        result["shard_count"] = n

    return result


def _run_manual(task: str, _args: argparse.Namespace) -> None:
    """Fallback to full manual selection."""
    print(f"\n{BOLD}🔀 Choose pattern:{RESET}")
    print(f"  {CYAN}1{RESET}  ✍️  Simple      {DIM}— writer → reviewer{RESET}")
    print(f"  {CYAN}2{RESET}  🔀 Multi-view   {DIM}— parallel → merge{RESET}")
    print(f"  {CYAN}3{RESET}  ⚖️  Debate       {DIM}— expert → challenger → synthesizer{RESET}")
    print(f"  {CYAN}4{RESET}  📊 Deep dive    {DIM}— shard → merge{RESET}")
    pattern = input(f"\n  {BOLD}Choose [1-4]:{RESET} ").strip() or "1"

    print(f"\n{BOLD}🤖 Choose model:{RESET}")
    print(f"  {CYAN}1{RESET}  Haiku   {CYAN}2{RESET}  Sonnet   {CYAN}3{RESET}  Opus")
    model_choice = input(f"  {BOLD}Choose [1-3]:{RESET} ").strip() or "1"

    or_key = os.environ.get("OPENROUTER_API_KEY", "")
    an_key = os.environ.get("ANTHROPIC_API_KEY", "")
    use_or = bool(or_key)

    if not or_key and not an_key:
        print(f"\n{RED}No API key found! Run 'mmcp setup' first.{RESET}")
        return

    model_map_or = {"1": "anthropic/claude-3.5-haiku", "2": "anthropic/claude-sonnet-4", "3": "anthropic/claude-opus-4"}
    model_map_an = {"1": "claude-haiku-4-5-20251001", "2": "claude-sonnet-4-20250514", "3": "claude-opus-4-20250514"}
    model = model_map_or.get(model_choice, model_map_or["1"]) if use_or else model_map_an.get(model_choice, model_map_an["1"])

    print(f"\n{BOLD}🚀 Running...{RESET}\n")

    if pattern == "1":
        orc = _make_orchestrator(["writer", "reviewer"], model, False, use_or)
        result = asyncio.run(orc.run_chain(task, ["writer", "reviewer"]))
    elif pattern == "2":
        roles = ["analyst", "creative", "critic"]
        orc = _make_orchestrator(roles + ["synthesizer"], model, False, use_or)
        result = asyncio.run(orc.run_parallel(task, roles, "synthesizer"))
    elif pattern == "3":
        orc = _make_orchestrator(["expert", "challenger", "synthesizer"], model, False, use_or)
        result = asyncio.run(orc.run_verify(task, "expert", "challenger", "synthesizer"))
    elif pattern == "4":
        orc = _make_orchestrator(["analyst", "editor"], model, False, use_or)
        result = asyncio.run(orc.run_sharded(task, "analyst", 3, "editor"))
    else:
        orc = _make_orchestrator(["writer", "reviewer"], model, False, use_or)
        result = asyncio.run(orc.run_chain(task, ["writer", "reviewer"]))

    _print_result(result, verbose=True)

    print()
    again = input(f"  {BOLD}Run another task? [y/N]:{RESET} ").strip().lower()
    if again in ("y", "yes"):
        cmd_run(_args)


def cmd_run(_args: argparse.Namespace) -> None:
    """Interactive prompt-based mode for non-developers with smart routing."""
    _load_env()
    _banner("Interactive Mode")
    print(f"  {DIM}Answer the prompts below. Press Ctrl+C to cancel.{RESET}\n")

    print(f"{BOLD}📝 What should the AI do?{RESET}")
    print(f"  {DIM}Just describe what you need in plain English.{RESET}")
    task = input(f"\n  {BOLD}Your task:{RESET} ").strip()
    if not task:
        print(f"{RED}No task provided. Exiting.{RESET}")
        return

    route = _smart_route(task)

    print(f"\n{BOLD}🧠 Smart Routing:{RESET}")
    print(f"  {CYAN}Pattern:{RESET}    {route['pattern_name']}  {DIM}— {route['pattern_reason']}{RESET}")
    print(f"  {CYAN}Model:{RESET}      {route['model_name']}  {DIM}— {route['model_reason']}{RESET}")
    print(f"  {CYAN}Agents:{RESET}     {route['roles_display']}")
    print(f"  {CYAN}Complexity:{RESET} {'🟢 Low' if route['complexity'] == 'low' else '🟡 Medium' if route['complexity'] == 'medium' else '🔴 High'}")

    override = input(f"\n  {BOLD}Accept? [Y/n/customize]:{RESET} ").strip().lower()

    if override in ("n", "no", "c", "customize"):
        return _run_manual(task, _args)

    pipeline_type = route["pipeline_type"]
    model = route["model"]
    roles_display = route["roles_display"]

    if pipeline_type == "chain":
        role1, role2 = route["roles"]
    elif pipeline_type == "parallel":
        fork_roles = route["roles"][:-1]
        merge_role = route["roles"][-1]
    elif pipeline_type == "verify":
        role_p, role_c, role_s = route["roles"]
    elif pipeline_type == "shard":
        shard_role = route["roles"][0]
        n = route.get("shard_count", 3)
        merge_role = route["roles"][-1]

    or_key = os.environ.get("OPENROUTER_API_KEY", "")
    an_key = os.environ.get("ANTHROPIC_API_KEY", "")
    use_or = bool(or_key)

    if not or_key and not an_key:
        print(f"\n{RED}No API key found! Run 'mmcp setup' first.{RESET}")
        return

    provider = "OpenRouter" if use_or else "Anthropic"

    save = input(f"\n{BOLD}💾 Save audit trail? [y/N]:{RESET} ").strip().lower()
    export_path = None
    if save in ("y", "yes"):
        export_path = f"./mmcp-audits/run_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"

    print(f"\n{'─' * 60}")
    print(f"  {BOLD}Task:{RESET}     {task}")
    print(f"  {BOLD}Pattern:{RESET}  {roles_display}")
    print(f"  {BOLD}Model:{RESET}    {model.split('/')[-1]}")
    print(f"  {BOLD}Via:{RESET}      {provider}")
    if export_path:
        print(f"  {BOLD}Export:{RESET}   {export_path}")
    print(f"{'─' * 60}")

    go = input(f"\n  {BOLD}Run? [Y/n]:{RESET} ").strip().lower()
    if go in ("n", "no"):
        print(f"{DIM}Cancelled.{RESET}")
        return

    print(f"\n{BOLD}🚀 Running...{RESET}\n")

    if pipeline_type == "chain":
        all_roles = [role1, role2]
        orc = _make_orchestrator(all_roles, model, False, use_or)
        result = asyncio.run(orc.run_chain(task, all_roles))
    elif pipeline_type == "parallel":
        all_roles = fork_roles + [merge_role]
        orc = _make_orchestrator(all_roles, model, False, use_or)
        result = asyncio.run(orc.run_parallel(task, fork_roles, merge_role))
    elif pipeline_type == "verify":
        all_roles = [role_p, role_c, role_s]
        orc = _make_orchestrator(all_roles, model, False, use_or)
        result = asyncio.run(orc.run_verify(task, role_p, role_c, role_s))
    elif pipeline_type == "shard":
        all_roles = [shard_role, merge_role]
        orc = _make_orchestrator(all_roles, model, False, use_or)
        result = asyncio.run(orc.run_sharded(task, shard_role, n, merge_role))

    _print_result(result, verbose=True)

    if export_path and result:
        fmt = MMCPWireFormat()
        wire_dag = fmt.serialize_dag(result.dag)
        os.makedirs(os.path.dirname(export_path) or ".", exist_ok=True)
        with open(export_path, "w") as f:
            json.dump(wire_dag, f, indent=2, default=str)
        print(f"\n{GREEN}📄 Audit trail saved: {export_path}{RESET}")

    print()
    again = input(f"  {BOLD}Run another task? [y/N]:{RESET} ").strip().lower()
    if again in ("y", "yes"):
        cmd_run(_args)
