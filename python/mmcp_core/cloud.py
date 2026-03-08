"""
MMCP Cloud adapter — calls MMCP Cloud proxy instead of OpenRouter directly.

Reads API key from ~/.mmcp/config.json and routes through api.mmcp.dev.
"""
from __future__ import annotations
import asyncio
import json
import os
from pathlib import Path

import httpx

from .types import ModelAssignment, ContextEnvelope

CONFIG_PATH = Path.home() / ".mmcp" / "config.json"
DEFAULT_CLOUD_URL = "https://api.mmcp.dev"


def load_cloud_config() -> dict | None:
    """Load cloud config from ~/.mmcp/config.json."""
    if not CONFIG_PATH.exists():
        return None
    with open(CONFIG_PATH) as f:
        return json.load(f)


def save_cloud_config(config: dict) -> None:
    """Save cloud config to ~/.mmcp/config.json."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)


def remove_cloud_config() -> None:
    """Remove cloud config file."""
    if CONFIG_PATH.exists():
        CONFIG_PATH.unlink()


def is_cloud_configured() -> bool:
    """Check if cloud mode is configured."""
    config = load_cloud_config()
    return config is not None and "api_key" in config


async def call_mmcp_cloud(
    assignment: ModelAssignment,
    context: ContextEnvelope,
) -> dict:
    """Call MMCP Cloud proxy API."""
    config = load_cloud_config()
    if not config or "api_key" not in config:
        raise ValueError("Not logged in. Run 'mmcp login' first.")

    api_key = config["api_key"]
    cloud_url = config.get("cloud_url", DEFAULT_CLOUD_URL)

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

    endpoint = f"{cloud_url}/v1/chat/completions"

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            endpoint,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json=body,
        )

        if response.status_code == 429:
            error = response.json() if response.headers.get("content-type", "").startswith("application/json") else {"detail": response.text}
            raise ValueError(f"Rate limit: {error.get('detail', 'Monthly limit reached')}")
        elif response.status_code == 401:
            raise ValueError("Invalid API key. Run 'mmcp login' again.")

        response.raise_for_status()
        data = response.json()

        output = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        usage = data.get("usage", {})
        billing = data.get("mmcp_billing", {})

        return {
            "output": output,
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
            "tokens_used": usage.get("total_tokens", 0),
            "model": data.get("model", assignment.model_id),
            "cost_usd": billing.get("billed_cost", 0),
        }
