"""
MMCP Cloud — Server-Sent Events (SSE) streaming for live pipeline output.

Usage:
  POST /v1/chat/completions/stream — streaming proxy with SSE
  
Events:
  data: {"type": "start", "model": "...", "step": 1}
  data: {"type": "token", "content": "...", "index": 0}
  data: {"type": "usage", "tokens": 150, "cost": 0.001}
  data: {"type": "done"}
  data: {"type": "error", "message": "..."}
"""
from __future__ import annotations
import json
import os
import time
from typing import AsyncGenerator

import httpx
from fastapi import HTTPException, Request
from starlette.responses import StreamingResponse

from .database import get_user_by_key, log_usage, get_usage
from .billing import apply_markup, check_rate_limit, get_month_start


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


def _sse_event(data: dict) -> str:
    """Format a dict as an SSE event string."""
    return f"data: {json.dumps(data)}\n\n"


async def stream_chat(
    model: str,
    messages: list[dict],
    max_tokens: int,
    temperature: float,
    user: dict,
) -> AsyncGenerator[str, None]:
    """Stream chat completions via SSE.
    
    Yields SSE-formatted events as the upstream model generates tokens.
    """
    or_key = os.environ.get("OPENROUTER_API_KEY")
    if not or_key:
        yield _sse_event({"type": "error", "message": "Server misconfigured: no upstream API key"})
        return

    # Check rate limit
    month_start = get_month_start()
    usage = get_usage(user["user_id"], since=month_start)
    limit_check = check_rate_limit(usage["runs"], user["plan"])

    if not limit_check["allowed"]:
        yield _sse_event({
            "type": "error",
            "message": f"Monthly limit reached ({limit_check['limit']} runs). Upgrade your plan.",
        })
        return

    # Start event
    yield _sse_event({"type": "start", "model": model})

    start = time.time()
    total_content = ""
    total_tokens = 0

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                OPENROUTER_URL,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {or_key}",
                    "HTTP-Referer": "https://mmcp.dev",
                    "X-Title": "MMCP Cloud",
                },
                json={
                    "model": model,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "messages": messages,
                    "stream": True,
                },
            ) as resp:
                if resp.status_code != 200:
                    await resp.aread()
                    yield _sse_event({"type": "error", "message": f"Upstream error: {resp.status_code}"})
                    return

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
                            total_content += content
                            yield _sse_event({"type": "token", "content": content})

                        # Track token usage from final chunk
                        if "usage" in chunk:
                            total_tokens = chunk["usage"].get("total_tokens", 0)

                    except json.JSONDecodeError:
                        continue

    except httpx.ReadTimeout:
        yield _sse_event({"type": "error", "message": "Upstream timeout"})
        return
    except Exception as e:
        yield _sse_event({"type": "error", "message": str(e)})
        return

    # Calculate cost
    duration_ms = int((time.time() - start) * 1000)
    # Estimate cost if not provided (rough estimate based on model)
    estimated_cost = total_tokens * 0.000001  # $1/1M tokens baseline
    billed_cost = apply_markup(estimated_cost, user["plan"])

    # Log usage
    log_usage(
        user_id=user["user_id"],
        tokens=total_tokens,
        cost_usd=billed_cost,
        model=model,
        pipeline="stream",
    )

    # Final usage event
    yield _sse_event({
        "type": "usage",
        "tokens": total_tokens,
        "cost_usd": round(billed_cost, 6),
        "duration_ms": duration_ms,
        "runs_remaining": limit_check["remaining"],
    })

    # Done event
    yield _sse_event({"type": "done"})


def register_stream_routes(app):
    """Register streaming endpoints on the FastAPI app."""

    @app.post("/v1/chat/completions/stream")
    async def chat_completions_stream(request: Request):
        """Stream chat completions via Server-Sent Events."""
        # Auth
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer mmcp_"):
            raise HTTPException(401, "Invalid API key")
        api_key = auth.replace("Bearer ", "")
        user = get_user_by_key(api_key)
        if not user:
            raise HTTPException(401, "Invalid or revoked API key")

        body = await request.json()
        model = body.get("model", "anthropic/claude-3.5-haiku")
        messages = body.get("messages", [])
        max_tokens = body.get("max_tokens", 4096)
        temperature = body.get("temperature", 0.7)

        return StreamingResponse(
            stream_chat(model, messages, max_tokens, temperature, user),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",  # Disable nginx buffering
            },
        )
