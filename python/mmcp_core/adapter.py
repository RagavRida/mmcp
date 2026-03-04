"""
MMCP Adapter — Real Anthropic API adapter. No mocks.
"""
from __future__ import annotations
import os
import asyncio
import httpx
from .types import ContextEnvelope, ModelAssignment

# Model pricing table — USD per 1M tokens
MODEL_PRICING: dict[str, dict[str, float]] = {
    "claude-opus-4-20250514":    {"input": 15,    "output": 75},
    "claude-sonnet-4-20250514":  {"input": 3,     "output": 15},
    "claude-haiku-4-5-20251001": {"input": 0.25,  "output": 1.25},
    "gpt-4o":                    {"input": 2.5,   "output": 10},
    "gpt-4o-mini":               {"input": 0.15,  "output": 0.6},
    "gemini-pro-1.5":            {"input": 1.25,  "output": 5},
}


def calculate_cost(
    model_id: str,
    input_tokens: int,
    output_tokens: int,
) -> float:
    pricing = MODEL_PRICING.get(model_id, {"input": 3, "output": 15})
    return (
        (input_tokens / 1_000_000 * pricing["input"])
        + (output_tokens / 1_000_000 * pricing["output"])
    )


async def call_anthropic(
    assignment: ModelAssignment,
    context: ContextEnvelope,
) -> dict:
    """Call Anthropic API with retry + exponential backoff."""
    api_key = assignment.api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")

    messages = context.history or []
    messages_dict = [
        {"role": m.role, "content": m.content}
        for m in messages
        if m.role != "system"
    ]
    if not messages_dict:
        messages_dict = [{"role": "user", "content": context.task}]

    body = {
        "model": assignment.model_id,
        "max_tokens": assignment.max_tokens,
        "system": assignment.system_prompt or "",
        "messages": messages_dict,
    }

    max_retries = 3
    for attempt in range(max_retries):
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                assignment.endpoint,
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                },
                json=body,
            )

            if response.status_code in (429, 529):
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
            elif response.status_code in (400, 401, 403):
                raise ValueError(
                    f"API error {response.status_code}: {response.text}"
                )

            response.raise_for_status()
            data = response.json()

            output = "".join(
                block["text"]
                for block in data.get("content", [])
                if block.get("type") == "text"
            )
            input_tokens = data.get("usage", {}).get("input_tokens", 0)
            output_tokens = data.get("usage", {}).get("output_tokens", 0)

            return {
                "output": output,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "tokens_used": input_tokens + output_tokens,
                "model": data.get("model", assignment.model_id),
                "cost_usd": calculate_cost(
                    assignment.model_id, input_tokens, output_tokens
                ),
            }

    raise ValueError("Max retries exceeded")


OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"


async def call_openrouter(
    assignment: ModelAssignment,
    context: ContextEnvelope,
) -> dict:
    """Call OpenRouter API (OpenAI-compatible) with retry + backoff."""
    api_key = assignment.api_key or os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY not set")

    messages = context.history or []
    chat_messages: list[dict] = []

    if assignment.system_prompt:
        chat_messages.append({"role": "system", "content": assignment.system_prompt})

    user_msgs = [
        {"role": m.role, "content": m.content}
        for m in messages
        if m.role != "system"
    ]
    if not user_msgs:
        user_msgs = [{"role": "user", "content": context.task}]
    chat_messages.extend(user_msgs)

    body = {
        "model": assignment.model_id,
        "max_tokens": assignment.max_tokens,
        "temperature": assignment.temperature,
        "messages": chat_messages,
    }

    endpoint = OPENROUTER_ENDPOINT
    max_retries = 3
    for attempt in range(max_retries):
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                endpoint,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                    "HTTP-Referer": "https://mmcp.dev",
                    "X-Title": "MMCP Orchestrator",
                },
                json=body,
            )

            if response.status_code in (429, 529):
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                    continue
            elif response.status_code in (400, 401, 403):
                raise ValueError(
                    f"OpenRouter API error {response.status_code}: {response.text}"
                )

            response.raise_for_status()
            data = response.json()

            output = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            usage = data.get("usage", {})
            input_tokens = usage.get("prompt_tokens", 0)
            output_tokens = usage.get("completion_tokens", 0)

            return {
                "output": output,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "tokens_used": input_tokens + output_tokens,
                "model": data.get("model", assignment.model_id),
                "cost_usd": calculate_cost(
                    assignment.model_id, input_tokens, output_tokens
                ),
            }

    raise ValueError("OpenRouter max retries exceeded")
