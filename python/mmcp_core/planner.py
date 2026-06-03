"""
MMCP v2.2 — Planner Agent.

Takes a user task → calls LLM to decompose → returns structured plan
with per-step model selection, error recovery, and context chaining.

v2.2: Integrates SmartRouter for intelligent model selection and
      ToolSelector for auto-discovering available tools.
      All config from MMCPConfig. Token-optimized prompts.
"""
from __future__ import annotations
import json
import os
from dataclasses import dataclass, field
from typing import Any

import httpx

from .types import ModelJustification


# ── Config-driven defaults (not hardcoded) ────────────────────────────────

def _get_config():
    """Lazy-load config to avoid circular imports."""
    from .config import get_config
    return get_config()


def _get_action_to_model() -> dict[str, str | None]:
    return _get_config().action_to_model


def _get_fallback_model() -> str:
    return _get_config().default_model


# ── Step schema ─────────────────────────────────────────────────────────────

@dataclass
class PlanStep:
    """A single step in an auto-generated pipeline."""
    step: int
    action: str                          # research, code, write, tool, mcp, etc.
    description: str                     # human-readable description
    model: str | None = None             # resolved from config or SmartRouter
    prompt: str | None = None            # prompt for model call
    tool_name: str | None = None         # for tool/mcp actions
    tool_args: dict[str, Any] = field(default_factory=dict)
    depends_on: list[int] = field(default_factory=list)  # step numbers this depends on
    # Error recovery
    retry_count: int = 2                 # max retries before fallback
    fallback_model: str | None = None    # model to try if primary fails (from config)
    fallback_action: str | None = None   # alternative action if step fails entirely
    # Intelligence (v2.2)
    justification: ModelJustification | None = None  # Why this model was chosen
    # Runtime state
    status: str = "pending"              # pending, running, done, failed, skipped
    output: str | None = None
    error: str | None = None
    tokens_used: int = 0
    cost_usd: float = 0.0

    def resolve_model(self) -> str | None:
        """Get the model ID — from SmartRouter justification, config, or fallback."""
        if self.model:
            return self.model
        return _get_action_to_model().get(self.action, _get_fallback_model())


@dataclass
class ExecutionPlan:
    """A full execution plan with context bus."""
    task: str
    steps: list[PlanStep]
    context: dict[str, Any] = field(default_factory=dict)  # shared context bus
    status: str = "pending"

    def get_step_output(self, step_num: int) -> str | None:
        """Get output from a completed step (for context chaining)."""
        return self.context.get(f"step_{step_num}_output")

    def set_step_output(self, step_num: int, output: str) -> None:
        """Store step output in the shared context bus."""
        self.context[f"step_{step_num}_output"] = output

    def build_step_prompt(self, step: PlanStep) -> str:
        """
        Build prompt with context from dependent steps injected.
        Token-optimized: truncates dependency outputs to max budget.
        """
        config = _get_config()
        max_injection = config.max_context_injection_tokens
        parts = []

        # Inject outputs from dependencies (token-budgeted)
        if step.depends_on:
            parts.append("## Context from previous steps:\n")
            # Budget per dependency
            per_dep_budget = max_injection // max(len(step.depends_on), 1)
            for dep_num in step.depends_on:
                dep_output = self.get_step_output(dep_num)
                if dep_output:
                    # Truncate to token budget
                    dep_output = config.truncate_to_tokens(dep_output, per_dep_budget)
                    dep_step = next((s for s in self.steps if s.step == dep_num), None)
                    dep_desc = dep_step.description if dep_step else f"Step {dep_num}"
                    parts.append(f"### {dep_desc}:\n{dep_output}\n")

        # Add the step's own prompt
        if step.prompt:
            parts.append(f"\n## Your task:\n{step.prompt}")
        else:
            parts.append(f"\n## Your task:\n{step.description}")

        return "\n".join(parts)

    def to_display(self) -> str:
        """Pretty-print the plan for user review."""
        lines = [f"\U0001f4cb Plan for: {self.task}\n"]
        icons = {
            "research": "\U0001f50d", "analyze": "\U0001f4ca", "code": "\U0001f4bb", "generate": "\U0001f9e0",
            "write": "\u270d\ufe0f", "review": "\u2705", "summarize": "\U0001f4dd", "tool": "\U0001f527",
            "mcp": "\U0001f50c", "math": "\U0001f522", "creative": "\U0001f3a8", "translate": "\U0001f310",
            "quick": "\u26a1",
        }
        for s in self.steps:
            icon = icons.get(s.action, "\u25b6\ufe0f")
            model = s.resolve_model()
            model_short = model.split("/")[-1] if model else "tool"
            deps = f" (needs step {','.join(str(d) for d in s.depends_on)})" if s.depends_on else ""
            lines.append(f"  Step {s.step}: {icon} {s.description} -> {model_short}{deps}")
        return "\n".join(lines)


# -- System Prompts ------------------------------------------------------------

# Compact prompt (~40% fewer tokens, same quality)
PLANNER_SYSTEM_PROMPT_COMPACT = """MMCP Planner: decompose tasks into JSON steps.

Each step: {"step": N, "action": TYPE, "description": STR, "prompt": STR|null, "tool_name": STR|null, "tool_args": {}|null, "depends_on": [N]}
Actions: research, analyze, code, write, generate, review, summarize, translate, quick, math, creative, tool
Tools: web_search, read_file, write_file, http_request, run_command
Rules: 3-6 steps max. Use depends_on for context chaining. End with final output step. No model names.
Return ONLY JSON array."""

# Verbose prompt (original)
PLANNER_SYSTEM_PROMPT_VERBOSE = """You are MMCP Planner. Decompose user tasks into executable steps.

Return a JSON array of steps. Each step has:
- "step": step number (1, 2, 3...)
- "action": one of: research, analyze, code, write, generate, review, summarize, translate, quick, math, creative, tool
- "description": short human-readable description
- "prompt": the detailed prompt for the model (null for tool actions)
- "tool_name": for "tool" actions only
- "tool_args": dict of arguments for the tool
- "depends_on": array of step numbers this step needs output from

Rules:
1. Keep plans to 3-6 steps. Don't over-decompose.
2. Use "depends_on" to chain context.
3. Use "tool" action for web search, file operations, HTTP calls.
4. Every plan must end with a step that produces the final output.
5. Do NOT invent model names. Only specify the "action".

Return ONLY valid JSON. No markdown, no explanation."""


def _get_system_prompt(config=None) -> str:
    """Get system prompt based on config token optimization setting."""
    if config is None:
        config = _get_config()
    if config.compact_system_prompts:
        return PLANNER_SYSTEM_PROMPT_COMPACT
    return PLANNER_SYSTEM_PROMPT_VERBOSE

# Backward compat
PLANNER_SYSTEM_PROMPT = PLANNER_SYSTEM_PROMPT_VERBOSE


async def plan_task(
    task: str,
    api_key: str | None = None,
    planner_model: str | None = None,
    smart_router: Any = None,
) -> ExecutionPlan:
    """
    Call LLM to decompose a task into an execution plan.

    v2.2: Uses config-driven planner model and token-optimized prompts.
    If smart_router is provided, auto-discovers tools and injects
    them into the prompt, then resolves models per step with justification.
    """
    config = _get_config()
    api_key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY required for planning")

    # Planner model from config if not specified
    planner_model = planner_model or config.planner_model

    # v2.2: Auto-discover available tools and build context
    tool_context = ""
    try:
        from .tool_selector import select_tools, build_tool_context
        tool_matches = select_tools(task, config=config)
        if tool_matches:
            tool_context = "\n\n" + build_tool_context(tool_matches, config=config)
    except ImportError:
        pass

    # Use compact or verbose prompt based on config
    system_prompt = _get_system_prompt(config)
    if tool_context:
        system_prompt += tool_context


    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": planner_model,
                "max_tokens": 2048,
                "temperature": 0.3,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Decompose this task into steps:\n\n{task}"},
                ],
            },
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"].strip()

    # Parse JSON — handle markdown code blocks and control characters
    # Strip markdown code fences
    if "```" in raw:
        # Extract content between first ``` and last ```
        parts = raw.split("```")
        # Find the part containing the JSON array
        for part in parts:
            cleaned = part.strip()
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
            if "[" in cleaned and "]" in cleaned:
                raw = cleaned
                break

    # Find the JSON array
    start = raw.find("[")
    end = raw.rfind("]") + 1
    if start < 0 or end <= start:
        raise ValueError(f"Planner returned non-JSON: {raw[:200]}")

    json_str = raw[start:end]

    try:
        steps_data = json.loads(json_str, strict=False)
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON parse error: {e}\nRaw: {json_str[:300]}")

    steps = []
    for s in steps_data:
        step = PlanStep(
            step=s["step"],
            action=s.get("action", "generate"),
            description=s.get("description", ""),
            prompt=s.get("prompt"),
            tool_name=s.get("tool_name"),
            tool_args=s.get("tool_args", {}),
            depends_on=s.get("depends_on", []),
        )

        # v2.2: Use SmartRouter to resolve model with justification
        if smart_router and step.action not in ("tool", "mcp"):
            try:
                decision = smart_router.route(
                    task=step.prompt or step.description,
                    action=step.action,
                )
                step.model = decision.model
                step.justification = decision.justification
            except Exception:
                pass  # Fall back to ACTION_TO_MODEL

        steps.append(step)

    return ExecutionPlan(task=task, steps=steps)
