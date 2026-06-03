"""
MMCP v2.2 — Pipeline Executor.

Takes an ExecutionPlan and runs each step:
  - Model calls via OpenRouter (auto-selected per step)
  - Tool calls via built-in tools (preferred) or MCP
  - Context chaining between steps
  - Error recovery with retry + fallback model
  - Cost tracking and RL feedback (v2.2)
"""
from __future__ import annotations
import asyncio
import os
import time
from typing import Any

import httpx

from .planner import ExecutionPlan, PlanStep
from .tools import execute_tool
from .mcp_client import MCPClient


def _get_fallback_model() -> str:
    from .config import get_config
    return get_config().default_model


# ANSI colors
BOLD = "\033[1m"
DIM = "\033[2m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
RESET = "\033[0m"


async def _call_model(
    model: str,
    prompt: str,
    api_key: str,
    max_tokens: int = 4096,
    temperature: float = 0.7,
) -> dict:
    """Call a model via OpenRouter."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
                "HTTP-Referer": "https://github.com/RagavRida/mmcp",
                "X-Title": "MMCP v2",
            },
            json={
                "model": model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        resp.raise_for_status()
        data = resp.json()
        usage = data.get("usage", {})
        return {
            "output": data["choices"][0]["message"]["content"],
            "tokens": usage.get("total_tokens", 0),
            "cost": usage.get("cost", 0) or 0,
        }


async def execute_plan(
    plan: ExecutionPlan,
    api_key: str | None = None,
    mcp_clients: dict[str, MCPClient] | None = None,
    on_step_start: Any = None,
    on_step_done: Any = None,
    smart_router: Any = None,
    cost_optimizer: Any = None,
) -> ExecutionPlan:
    """
    Execute a plan step-by-step with error recovery and context chaining.

    Args:
        plan: The execution plan to run
        api_key: OpenRouter API key
        mcp_clients: Dict of connected MCP clients {name: client}
        on_step_start: Callback(step) called when a step starts
        on_step_done: Callback(step) called when a step completes
        smart_router: SmartRouter instance for RL feedback (v2.2)
        cost_optimizer: CostOptimizer instance for expense tracking (v2.2)
    """
    api_key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
    mcp_clients = mcp_clients or {}

    plan.status = "running"
    total_tokens = 0
    total_cost = 0.0

    for step in plan.steps:
        # Skip if a dependency failed
        failed_deps = [
            d for d in step.depends_on
            if any(s.step == d and s.status == "failed" for s in plan.steps)
        ]
        if failed_deps:
            step.status = "skipped"
            step.error = f"Skipped: dependency step(s) {failed_deps} failed"
            if on_step_done:
                on_step_done(step)
            continue

        step.status = "running"
        if on_step_start:
            on_step_start(step)

        try:
            if step.action in ("tool",) and step.tool_name:
                # ── Tool call (v2.2: auto-resolve built-in vs MCP) ──────
                from .tool_selector import resolve_tool
                resolved_name, source = resolve_tool(step.tool_name)
                args = dict(step.tool_args)
                step_start = time.monotonic()

                if source == "builtin":
                    output = await execute_tool(resolved_name, args)
                    latency = int((time.monotonic() - step_start) * 1000)

                    # Track built-in tool cost (free)
                    if cost_optimizer:
                        cost_optimizer.record_builtin_call(
                            task=step.description,
                            tool_name=resolved_name,
                            latency_ms=latency,
                            success=True,
                        )
                else:
                    # MCP tool fallback
                    server_name = args.pop("server", source.split(":", 1)[-1] if ":" in source else "")
                    client = (mcp_clients or {}).get(server_name)
                    if client and client.connected:
                        output = await client.call_tool(step.tool_name, args)
                        latency = int((time.monotonic() - step_start) * 1000)

                        if cost_optimizer:
                            cost_optimizer.record_mcp_call(
                                task=step.description,
                                server_name=server_name,
                                tool_name=step.tool_name,
                                latency_ms=latency,
                                overhead_ms=latency,  # Approximate
                                success=True,
                                builtin_available=step.tool_name in resolve_tool.__module__,
                            )
                    else:
                        output = f"Error: MCP server for tool '{step.tool_name}' not connected. " \
                                 f"Try built-in tools: web_search, read_file, write_file, http_request, run_command"

                step.output = output
                step.status = "done"

            elif step.action in ("mcp",) and step.tool_name:
                # ── MCP tool call ───────────────────────────────────
                server_name = step.tool_args.get("server", "")
                client = mcp_clients.get(server_name)
                if not client or not client.connected:
                    step.output = f"Error: MCP server '{server_name}' not connected"
                    step.status = "failed"
                else:
                    output = await client.call_tool(step.tool_name, step.tool_args)
                    step.output = output
                    step.status = "done"

            else:
                # ── Model call ──────────────────────────────────────────────────
                model = step.resolve_model() or _get_fallback_model()
                prompt = plan.build_step_prompt(step)
                domain = "general"
                if step.justification:
                    domain = step.justification.domain

                # Try primary model with retries
                last_error = None
                for attempt in range(step.retry_count + 1):
                    try:
                        current_model = model if attempt == 0 else step.fallback_model
                        step_start = time.monotonic()
                        result = await _call_model(current_model, prompt, api_key)
                        step_latency = int((time.monotonic() - step_start) * 1000)

                        step.output = result["output"]
                        step.tokens_used = result["tokens"]
                        step.cost_usd = result["cost"]
                        total_tokens += result["tokens"]
                        total_cost += result["cost"]
                        step.status = "done"
                        last_error = None

                        # v2.2: Record RL outcome
                        if smart_router:
                            smart_router.record_outcome(
                                model=current_model,
                                domain=domain,
                                success=True,
                                latency_ms=step_latency,
                                cost_usd=result["cost"],
                            )

                        # v2.2: Record expense
                        if cost_optimizer:
                            from .types import TaskComplexity
                            complexity = (
                                step.justification.task_complexity
                                if step.justification
                                else TaskComplexity.STANDARD
                            )
                            was_justified = (
                                step.justification is not None
                            )
                            cost_optimizer.record_model_call(
                                task=step.description,
                                model=current_model,
                                domain=domain,
                                complexity=complexity,
                                input_tokens=0,  # Not tracked at this level
                                output_tokens=result["tokens"],
                                cost_usd=result["cost"],
                                latency_ms=step_latency,
                                success=True,
                                was_justified=was_justified,
                            )

                        break
                    except Exception as e:
                        last_error = str(e)
                        if attempt < step.retry_count:
                            await asyncio.sleep(1 * (attempt + 1))  # backoff

                        # v2.2: Record failed RL outcome
                        if smart_router and attempt == step.retry_count:
                            smart_router.record_outcome(
                                model=model,
                                domain=domain,
                                success=False,
                                latency_ms=0,
                                cost_usd=0,
                            )

                if last_error:
                    step.status = "failed"
                    step.error = last_error

            # Store output in context bus for downstream steps
            if step.status == "done" and step.output:
                plan.set_step_output(step.step, step.output)

        except Exception as e:
            step.status = "failed"
            step.error = str(e)

        if on_step_done:
            on_step_done(step)

    # Determine overall status
    failed_steps = [s for s in plan.steps if s.status == "failed"]
    skipped_steps = [s for s in plan.steps if s.status == "skipped"]

    if failed_steps:
        plan.status = "partial" if any(s.status == "done" for s in plan.steps) else "failed"
    else:
        plan.status = "done"

    # Store summary in context
    plan.context["_total_tokens"] = total_tokens
    plan.context["_total_cost"] = total_cost
    plan.context["_failed_steps"] = len(failed_steps)
    plan.context["_skipped_steps"] = len(skipped_steps)

    return plan


def print_plan_progress(step: PlanStep, total: int, phase: str = "start") -> None:
    """Print step progress to terminal."""
    icons = {
        "research": "🔍", "analyze": "📊", "code": "💻", "generate": "🧠",
        "write": "✍️", "review": "✅", "summarize": "📝", "tool": "🔧",
        "mcp": "🔌", "math": "🔢", "creative": "🎨", "quick": "⚡",
    }
    icon = icons.get(step.action, "▶️")

    if phase == "start":
        model = step.resolve_model()
        model_short = model.split("/")[-1] if model else "tool"
        print(f"  [{step.step}/{total}] {icon} {step.description} → {model_short}...", end="", flush=True)
    elif phase == "done":
        if step.status == "done":
            tokens = f" [{step.tokens_used}t]" if step.tokens_used else ""
            cost = f" ${step.cost_usd:.4f}" if step.cost_usd else ""
            print(f" {GREEN}✓{RESET}{tokens}{cost}")
        elif step.status == "failed":
            print(f" {RED}✗ {step.error}{RESET}")
        elif step.status == "skipped":
            print(f" {YELLOW}⊘ skipped{RESET}")
