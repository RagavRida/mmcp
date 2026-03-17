"""
MMCP v2 — Planner Agent.

Takes a user task → calls LLM to decompose → returns structured plan
with per-step model selection, error recovery, and context chaining.
"""
from __future__ import annotations
import json
import os
from dataclasses import dataclass, field, asdict
from typing import Any

import httpx


# ── Explicit model routing table ────────────────────────────────────────────
# No hallucinated model names — the planner picks an action type,
# this table maps to the real model ID.

ACTION_TO_MODEL: dict[str, str] = {
    "research":   "deepseek/deepseek-r1",
    "analyze":    "deepseek/deepseek-r1",
    "code":       "google/gemini-2.5-pro-preview",
    "generate":   "anthropic/claude-sonnet-4",
    "write":      "anthropic/claude-sonnet-4",
    "review":     "anthropic/claude-3.5-haiku",
    "summarize":  "anthropic/claude-3.5-haiku",
    "translate":  "meta-llama/llama-4-maverick",
    "quick":      "meta-llama/llama-4-maverick",
    "math":       "deepseek/deepseek-r1",
    "creative":   "anthropic/claude-sonnet-4",
    "tool":       None,   # no model, direct tool call
    "mcp":        None,   # no model, MCP tool call
}

FALLBACK_MODEL = "anthropic/claude-3.5-haiku"


# ── Step schema ─────────────────────────────────────────────────────────────

@dataclass
class PlanStep:
    """A single step in an auto-generated pipeline."""
    step: int
    action: str                          # research, code, write, tool, mcp, etc.
    description: str                     # human-readable description
    model: str | None = None             # resolved from ACTION_TO_MODEL
    prompt: str | None = None            # prompt for model call
    tool_name: str | None = None         # for tool/mcp actions
    tool_args: dict[str, Any] = field(default_factory=dict)
    depends_on: list[int] = field(default_factory=list)  # step numbers this depends on
    # Error recovery
    retry_count: int = 2                 # max retries before fallback
    fallback_model: str = FALLBACK_MODEL # model to try if primary fails
    fallback_action: str | None = None   # alternative action if step fails entirely
    # Runtime state
    status: str = "pending"              # pending, running, done, failed, skipped
    output: str | None = None
    error: str | None = None
    tokens_used: int = 0
    cost_usd: float = 0.0

    def resolve_model(self) -> str | None:
        """Get the model ID from the action type."""
        if self.model:
            return self.model
        return ACTION_TO_MODEL.get(self.action, FALLBACK_MODEL)


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
        """Build prompt with context from dependent steps injected."""
        parts = []

        # Inject outputs from dependencies
        if step.depends_on:
            parts.append("## Context from previous steps:\n")
            for dep_num in step.depends_on:
                dep_output = self.get_step_output(dep_num)
                if dep_output:
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
        lines = [f"📋 Plan for: {self.task}\n"]
        icons = {
            "research": "🔍", "analyze": "📊", "code": "💻", "generate": "🧠",
            "write": "✍️", "review": "✅", "summarize": "📝", "tool": "🔧",
            "mcp": "🔌", "math": "🔢", "creative": "🎨", "translate": "🌐",
            "quick": "⚡",
        }
        for s in self.steps:
            icon = icons.get(s.action, "▶️")
            model = s.resolve_model()
            model_short = model.split("/")[-1] if model else "tool"
            deps = f" (needs step {','.join(str(d) for d in s.depends_on)})" if s.depends_on else ""
            lines.append(f"  Step {s.step}: {icon} {s.description} → {model_short}{deps}")
        return "\n".join(lines)


# ── Planner prompt ──────────────────────────────────────────────────────────

PLANNER_SYSTEM_PROMPT = """You are MMCP Planner — you decompose user tasks into executable steps.

Return a JSON array of steps. Each step has:
- "step": step number (1, 2, 3...)
- "action": one of: research, analyze, code, write, generate, review, summarize, translate, quick, math, creative, tool
- "description": short human-readable description
- "prompt": the detailed prompt for the model (null for tool actions)
- "tool_name": for "tool" actions only — one of: web_search, read_file, write_file, http_request
- "tool_args": dict of arguments for the tool (e.g., {"query": "..."} for web_search)
- "depends_on": array of step numbers this step needs output from (for context chaining)

Rules:
1. Keep plans to 3-6 steps. Don't over-decompose.
2. Use "depends_on" to chain context — Step 3 can reference Step 1's output.
3. Use "tool" action for web search, file operations, HTTP calls.
4. Use "research" for deep analysis, "code" for programming, "write" for content.
5. Every plan must end with a step that produces the final output.
6. Do NOT invent model names. Only specify the "action" — models are auto-selected.

Example for "Research AI trends and write a blog post":
[
  {"step": 1, "action": "tool", "description": "Search for latest AI trends", "tool_name": "web_search", "tool_args": {"query": "AI trends 2026"}, "depends_on": []},
  {"step": 2, "action": "research", "description": "Analyze search results", "prompt": "Analyze these AI trends and identify the top 5 most impactful ones.", "depends_on": [1]},
  {"step": 3, "action": "write", "description": "Write blog post", "prompt": "Write a 1000-word blog post covering the top AI trends of 2026. Make it engaging and informative.", "depends_on": [2]},
  {"step": 4, "action": "review", "description": "Review and polish", "prompt": "Review this blog post for clarity, accuracy, and engagement. Fix any issues.", "depends_on": [3]}
]

Return ONLY valid JSON. No markdown, no explanation."""


async def plan_task(
    task: str,
    api_key: str | None = None,
    planner_model: str = "anthropic/claude-3.5-haiku",
) -> ExecutionPlan:
    """Call LLM to decompose a task into an execution plan."""
    api_key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY required for planning")

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
                    {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
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
        steps.append(PlanStep(
            step=s["step"],
            action=s.get("action", "generate"),
            description=s.get("description", ""),
            prompt=s.get("prompt"),
            tool_name=s.get("tool_name"),
            tool_args=s.get("tool_args", {}),
            depends_on=s.get("depends_on", []),
        ))

    return ExecutionPlan(task=task, steps=steps)
