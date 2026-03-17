"""
MMCP v2 — Built-in tools.

Tools that work without MCP servers:
  - web_search     — DuckDuckGo instant answers (free, no API key)
  - http_request   — call any REST API
  - read_file      — read local file
  - write_file     — write local file
  - run_command    — ⚠️ SECURITY: sandboxed, allowlisted commands only

SECURITY NOTE:
  run_command uses a strict allowlist. It is NOT suitable for
  multi-user/networked environments without additional sandboxing.
  See COMMAND_ALLOWLIST below.
"""
from __future__ import annotations
import json
import os
import subprocess
from pathlib import Path
from typing import Any

import httpx


# ── Security: Command allowlist ─────────────────────────────────────────────
# Only these command prefixes are allowed in run_command.
# This is a MINIMAL allowlist — not a security boundary for production.
COMMAND_ALLOWLIST = [
    "echo", "cat", "ls", "pwd", "date", "wc",
    "python3", "node", "npm", "npx",
    "git status", "git log", "git diff",
    "curl", "wget",
]

TOOL_REGISTRY: dict[str, dict] = {
    "web_search": {
        "description": "Search the web using DuckDuckGo (free, no API key needed)",
        "parameters": {"query": "Search query string"},
    },
    "http_request": {
        "description": "Make an HTTP request to any URL",
        "parameters": {"method": "GET/POST/PUT/DELETE", "url": "Target URL", "body": "Optional JSON body"},
    },
    "read_file": {
        "description": "Read contents of a local file",
        "parameters": {"path": "Absolute or relative file path"},
    },
    "write_file": {
        "description": "Write content to a local file",
        "parameters": {"path": "File path", "content": "Content to write"},
    },
    "run_command": {
        "description": "⚠️ Run a shell command (allowlisted only)",
        "parameters": {"command": "Shell command to execute"},
    },
}


# ── Web Search ──────────────────────────────────────────────────────────────

async def web_search(query: str) -> str:
    """Search via DuckDuckGo instant answers API (free, no key needed)."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        # DuckDuckGo instant answer API
        resp = await client.get(
            "https://api.duckduckgo.com/",
            params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
        )
        data = resp.json()

        results = []

        # Abstract (main answer)
        if data.get("Abstract"):
            results.append(f"**Summary**: {data['Abstract']}")
            if data.get("AbstractSource"):
                results.append(f"Source: {data['AbstractSource']}")

        # Related topics
        for topic in data.get("RelatedTopics", [])[:5]:
            if isinstance(topic, dict) and topic.get("Text"):
                results.append(f"• {topic['Text']}")

        # Answer (direct computation)
        if data.get("Answer"):
            results.append(f"**Answer**: {data['Answer']}")

        if not results:
            # Fallback: try a simple scrape of search results
            resp2 = await client.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={"User-Agent": "MMCP/2.0"},
            )
            # Extract text snippets from results
            text = resp2.text
            snippets = []
            for marker in ['class="result__snippet">', 'class="result__a">']:
                start = 0
                for _ in range(5):
                    idx = text.find(marker, start)
                    if idx == -1:
                        break
                    end = text.find("<", idx + len(marker))
                    if end > idx:
                        snippet = text[idx + len(marker):end].strip()
                        if snippet and len(snippet) > 20:
                            snippets.append(f"• {snippet}")
                    start = idx + 1
            if snippets:
                results = snippets

        return "\n".join(results) if results else f"No results found for: {query}"


# ── HTTP Request ────────────────────────────────────────────────────────────

async def http_request(method: str = "GET", url: str = "", body: dict | None = None) -> str:
    """Make an HTTP request and return the response."""
    if not url:
        return "Error: URL is required"

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        try:
            resp = await client.request(
                method.upper(),
                url,
                json=body if body else None,
                headers={"User-Agent": "MMCP/2.0"},
            )
            content_type = resp.headers.get("content-type", "")

            if "json" in content_type:
                return json.dumps(resp.json(), indent=2)[:4000]
            else:
                return resp.text[:4000]
        except Exception as e:
            return f"HTTP Error: {e}"


# ── File Operations ─────────────────────────────────────────────────────────

async def read_file(path: str) -> str:
    """Read a local file."""
    p = Path(path).expanduser()
    if not p.exists():
        return f"Error: File not found: {path}"
    if not p.is_file():
        return f"Error: Not a file: {path}"
    try:
        content = p.read_text(encoding="utf-8")
        if len(content) > 10000:
            return content[:10000] + f"\n... (truncated, {len(content)} chars total)"
        return content
    except Exception as e:
        return f"Error reading file: {e}"


async def write_file(path: str, content: str = "") -> str:
    """Write content to a local file."""
    p = Path(path).expanduser()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return f"✅ Written {len(content)} chars to {path}"
    except Exception as e:
        return f"Error writing file: {e}"


# ── Shell Command (SECURITY: allowlisted only) ─────────────────────────────

async def run_command(command: str) -> str:
    """
    Run a shell command. SECURITY: Only allowlisted command prefixes.

    ⚠️ WARNING: This is NOT a security boundary for production/multi-user use.
    It's a basic guard for local single-user development only.
    """
    cmd_lower = command.strip().lower()

    # Check allowlist
    allowed = any(cmd_lower.startswith(prefix) for prefix in COMMAND_ALLOWLIST)
    if not allowed:
        return (
            f"⚠️ BLOCKED: '{command}' is not in the command allowlist.\n"
            f"Allowed prefixes: {', '.join(COMMAND_ALLOWLIST)}\n"
            f"This restriction exists for security. Run manually if needed."
        )

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30,
            cwd=os.getcwd(),
        )
        output = result.stdout
        if result.stderr:
            output += f"\nSTDERR: {result.stderr}"
        if result.returncode != 0:
            output += f"\nExit code: {result.returncode}"
        return output[:4000] if output else "(no output)"
    except subprocess.TimeoutExpired:
        return "Error: Command timed out (30s limit)"
    except Exception as e:
        return f"Error: {e}"


# ── Tool Dispatcher ─────────────────────────────────────────────────────────


TOOL_FUNCTIONS = {
    "web_search": lambda args: web_search(args.get("query", "")),
    "http_request": lambda args: http_request(
        args.get("method", "GET"), args.get("url", ""), args.get("body")
    ),
    "read_file": lambda args: read_file(args.get("path", "")),
    "write_file": lambda args: write_file(args.get("path", ""), args.get("content", "")),
    "run_command": lambda args: run_command(args.get("command", "")),
}


async def execute_tool(tool_name: str, tool_args: dict[str, Any]) -> str:
    """Execute a built-in tool by name."""
    func = TOOL_FUNCTIONS.get(tool_name)
    if not func:
        return f"Error: Unknown tool '{tool_name}'. Available: {list(TOOL_FUNCTIONS.keys())}"
    return await func(tool_args)
