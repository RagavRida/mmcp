"""
MMCP v2 — MCP Client.

Connects to any MCP server via stdio transport.
Implements the MCP (Model Context Protocol) client spec:
  - Initialize handshake
  - Tool discovery (tools/list)
  - Tool execution (tools/call)
"""
from __future__ import annotations
import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any


# ── Well-known MCP servers ──────────────────────────────────────────────────

MCP_SERVERS: dict[str, dict] = {
    "filesystem": {
        "command": "npx",
        "args": ["-y", "@anthropic-ai/mcp-server-filesystem", os.path.expanduser("~")],
        "description": "Read/write files, list directories",
    },
    "fetch": {
        "command": "npx",
        "args": ["-y", "@anthropic-ai/mcp-server-fetch"],
        "description": "Fetch web pages and APIs",
    },
    "github": {
        "command": "npx",
        "args": ["-y", "@anthropic-ai/mcp-server-github"],
        "description": "GitHub operations (requires GITHUB_TOKEN)",
        "env": {"GITHUB_TOKEN": os.environ.get("GITHUB_TOKEN", "")},
    },
}


@dataclass
class MCPTool:
    """Represents a tool exposed by an MCP server."""
    name: str
    description: str
    input_schema: dict


class MCPClient:
    """
    MCP client that communicates with servers via JSON-RPC over stdio.
    """

    def __init__(self) -> None:
        self._process: asyncio.subprocess.Process | None = None
        self._request_id: int = 0
        self._tools: list[MCPTool] = []
        self._server_name: str = ""

    async def connect(self, command: str, args: list[str] | None = None,
                      env: dict | None = None) -> None:
        """Start an MCP server process and initialize."""
        merged_env = {**os.environ, **(env or {})}

        self._process = await asyncio.create_subprocess_exec(
            command, *(args or []),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=merged_env,
        )

        # Send initialize request
        init_resp = await self._send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "mmcp", "version": "2.0.0"},
        })

        self._server_name = init_resp.get("serverInfo", {}).get("name", "unknown")

        # Send initialized notification
        await self._send_notification("notifications/initialized", {})

    async def connect_by_name(self, name: str) -> None:
        """Connect to a well-known MCP server by name."""
        config = MCP_SERVERS.get(name)
        if not config:
            raise ValueError(
                f"Unknown MCP server: {name}. "
                f"Available: {list(MCP_SERVERS.keys())}"
            )
        await self.connect(
            config["command"],
            config.get("args", []),
            config.get("env"),
        )

    async def list_tools(self) -> list[MCPTool]:
        """Discover tools from the connected MCP server."""
        resp = await self._send_request("tools/list", {})
        self._tools = []
        for t in resp.get("tools", []):
            self._tools.append(MCPTool(
                name=t["name"],
                description=t.get("description", ""),
                input_schema=t.get("inputSchema", {}),
            ))
        return self._tools

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """Execute a tool on the MCP server."""
        resp = await self._send_request("tools/call", {
            "name": name,
            "arguments": arguments,
        })

        # Extract text content from response
        content = resp.get("content", [])
        texts = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") == "text":
                    texts.append(item.get("text", ""))
                elif item.get("type") == "image":
                    texts.append(f"[image: {item.get('mimeType', 'unknown')}]")
            elif isinstance(item, str):
                texts.append(item)

        return "\n".join(texts) if texts else str(resp)

    async def disconnect(self) -> None:
        """Shutdown the MCP server process."""
        if self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self._process.kill()
        self._process = None

    # ── JSON-RPC transport ──────────────────────────────────────────────

    async def _send_request(self, method: str, params: dict) -> dict:
        """Send a JSON-RPC request and wait for response."""
        if not self._process or not self._process.stdin or not self._process.stdout:
            raise RuntimeError("Not connected to MCP server")

        self._request_id += 1
        request = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params,
        }

        msg = json.dumps(request) + "\n"
        self._process.stdin.write(msg.encode())
        await self._process.stdin.drain()

        # Read response
        line = await asyncio.wait_for(
            self._process.stdout.readline(),
            timeout=30.0,
        )

        if not line:
            # Check stderr for errors
            if self._process.stderr:
                err = await self._process.stderr.read(4096)
                raise RuntimeError(f"MCP server closed. stderr: {err.decode()}")
            raise RuntimeError("MCP server closed connection")

        response = json.loads(line.decode())

        if "error" in response:
            err = response["error"]
            raise RuntimeError(f"MCP error: {err.get('message', str(err))}")

        return response.get("result", {})

    async def _send_notification(self, method: str, params: dict) -> None:
        """Send a JSON-RPC notification (no response expected)."""
        if not self._process or not self._process.stdin:
            raise RuntimeError("Not connected to MCP server")

        notification = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }

        msg = json.dumps(notification) + "\n"
        self._process.stdin.write(msg.encode())
        await self._process.stdin.drain()

    @property
    def connected(self) -> bool:
        return self._process is not None and self._process.returncode is None

    @property
    def server_name(self) -> str:
        return self._server_name

    def __repr__(self) -> str:
        status = "connected" if self.connected else "disconnected"
        return f"MCPClient({self._server_name}, {status}, {len(self._tools)} tools)"
