"""
MMCP Core — Streaming executor for live pipeline output.

Provides an async generator that yields progress events during plan execution,
enabling CLI and SDK consumers to display real-time progress.

Events:
  {"type": "plan_start", "task": "...", "steps": 5}
  {"type": "step_start", "step": 1, "action": "research", "model": "..."}
  {"type": "step_token", "step": 1, "content": "..."}
  {"type": "step_done", "step": 1, "tokens": 150, "cost": 0.001}
  {"type": "step_error", "step": 1, "error": "..."}
  {"type": "plan_done", "status": "done", "total_tokens": 500, "total_cost": 0.005}
"""
from __future__ import annotations
import json
import os
from typing import AsyncGenerator

import httpx

from .planner import ExecutionPlan, PlanStep, ACTION_TO_MODEL


async def stream_execute(
    plan: ExecutionPlan,
    api_key: str | None = None,
) -> AsyncGenerator[dict, None]:
    """Execute a plan and yield progress events as an async generator.
    
    Usage:
        async for event in stream_execute(plan, api_key="sk-..."):
            if event["type"] == "step_token":
                print(event["content"], end="", flush=True)
    """
    api_key = api_key or os.environ.get("OPENROUTER_API_KEY", "")
    context: dict[int, str] = {}
    total_tokens = 0
    total_cost = 0.0
    failed_steps = 0

    yield {
        "type": "plan_start",
        "task": plan.task,
        "steps": len(plan.steps),
    }

    for step in plan.steps:
        # Resolve model
        model = step.model or ACTION_TO_MODEL.get(step.action, "anthropic/claude-3.5-haiku")
        if model is None:
            model = "anthropic/claude-3.5-haiku"

        yield {
            "type": "step_start",
            "step": step.step,
            "action": step.action,
            "description": step.description,
            "model": model,
        }

        # Build prompt with context from dependencies
        prompt = step.prompt or step.description
        if step.depends_on:
            dep_context = "\n\n".join(
                f"[Step {d} output]: {context.get(d, '(no output)')}"
                for d in step.depends_on
                if d in context
            )
            if dep_context:
                prompt = f"{dep_context}\n\n{prompt}"

        # Check if this is a tool action (no LLM call)
        if step.action == "tool":
            try:
                from .tools import execute_tool
                tool_name = step.tool or ""
                tool_args = step.tool_args or {}
                result = await execute_tool(tool_name, tool_args)
                context[step.step] = result
                step.status = "done"
                step.output = result

                yield {"type": "step_token", "step": step.step, "content": result}
                yield {"type": "step_done", "step": step.step, "tokens": 0, "cost": 0}
                continue
            except Exception as e:
                failed_steps += 1
                step.status = "failed"
                yield {"type": "step_error", "step": step.step, "error": str(e)}
                continue

        # Stream LLM call
        step_content = ""
        step_tokens = 0

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}",
                        "HTTP-Referer": "https://mmcp.dev",
                        "X-Title": "MMCP",
                    },
                    json={
                        "model": model,
                        "max_tokens": 4096,
                        "stream": True,
                        "messages": [
                            {"role": "system", "content": f"You are a helpful AI assistant. Action: {step.action}"},
                            {"role": "user", "content": prompt},
                        ],
                    },
                ) as resp:
                    if resp.status_code != 200:
                        body = await resp.aread()
                        raise Exception(f"API error {resp.status_code}: {body.decode()[:200]}")

                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue

                        payload = line[6:].strip()
                        if payload == "[DONE]":
                            break

                        try:
                            chunk = json.loads(payload)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content", "")

                            if content:
                                step_content += content
                                yield {"type": "step_token", "step": step.step, "content": content}

                            if "usage" in chunk:
                                step_tokens = chunk["usage"].get("total_tokens", 0)

                        except json.JSONDecodeError:
                            continue

            # Estimate tokens if not provided
            if step_tokens == 0:
                step_tokens = len(step_content.split()) * 2  # rough estimate

            step_cost = step_tokens * 0.000001  # baseline estimate
            total_tokens += step_tokens
            total_cost += step_cost

            context[step.step] = step_content
            step.status = "done"
            step.output = step_content

            yield {
                "type": "step_done",
                "step": step.step,
                "tokens": step_tokens,
                "cost": round(step_cost, 6),
            }

        except Exception as e:
            failed_steps += 1
            step.status = "failed"
            step.output = str(e)

            yield {"type": "step_error", "step": step.step, "error": str(e)}

            # Check retry/fallback
            if step.on_fail == "skip":
                continue
            elif step.on_fail == "retry":
                # Simple retry (non-streaming for simplicity)
                yield {"type": "step_start", "step": step.step, "action": step.action,
                       "description": f"(retry) {step.description}", "model": model}
                try:
                    async with httpx.AsyncClient(timeout=120.0) as client:
                        resp = await client.post(
                            "https://openrouter.ai/api/v1/chat/completions",
                            headers={
                                "Content-Type": "application/json",
                                "Authorization": f"Bearer {api_key}",
                            },
                            json={
                                "model": step.fallback_model or model,
                                "max_tokens": 4096,
                                "messages": [{"role": "user", "content": prompt}],
                            },
                        )
                    if resp.status_code == 200:
                        data = resp.json()
                        step_content = data["choices"][0]["message"]["content"]
                        context[step.step] = step_content
                        step.status = "done"
                        step.output = step_content
                        yield {"type": "step_token", "step": step.step, "content": step_content}
                        yield {"type": "step_done", "step": step.step, "tokens": 0, "cost": 0}
                        failed_steps -= 1
                except Exception:
                    pass

    status = "done" if failed_steps == 0 else ("partial" if failed_steps < len(plan.steps) else "failed")

    yield {
        "type": "plan_done",
        "status": status,
        "total_tokens": total_tokens,
        "total_cost": round(total_cost, 6),
        "failed_steps": failed_steps,
    }
