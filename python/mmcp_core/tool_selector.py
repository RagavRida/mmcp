"""
MMCP v2.2 — Auto Tool Selector (Cost-Aware).

Automatically discovers available tools (built-in + MCP servers) and matches
them to task requirements. ALWAYS prefers free built-in tools over expensive
MCP calls.

All tool registrations, MCP mappings, and server configs come from MMCPConfig.
Nothing is hardcoded — developers register tools via config.

Priority hierarchy:
  1. Built-in tool    → Free, instant (~5ms)
  2. Warm MCP conn    → Already connected (~50ms)
  3. Cold MCP conn    → Needs startup (~2-5s)
  4. LLM-as-tool      → Token cost (~1-3s)
"""
from __future__ import annotations
import re
import time
from dataclasses import dataclass, field
from typing import Any

from .types import ToolTier, ToolMatch, MCPCallMetrics


# ── Tool Capability ─────────────────────────────────────────────────────────

@dataclass
class ToolCapability:
    """Metadata about a tool's capabilities and cost."""
    name: str
    description: str
    tags: list[str]
    tier: ToolTier
    cost_per_call: float
    avg_latency_ms: int
    source: str                   # "builtin" | "mcp:server_name"
    parameters: dict[str, str] = field(default_factory=dict)


# ── Config-Driven Registry ──────────────────────────────────────────────────

def _load_builtin_tools(config: Any | None = None) -> dict[str, ToolCapability]:
    """Build ToolCapability registry from config — not hardcoded."""
    if config is None:
        from .config import get_config
        config = get_config()

    tools: dict[str, ToolCapability] = {}
    for name, spec in config.builtin_tools.items():
        tools[name] = ToolCapability(
            name=name,
            description=spec.get("description", ""),
            tags=spec.get("tags", []),
            tier=ToolTier.BUILTIN,
            cost_per_call=spec.get("cost_per_call", 0.0),
            avg_latency_ms=spec.get("avg_latency_ms", 100),
            source="builtin",
            parameters=spec.get("parameters", {}),
        )
    return tools


def _load_mcp_equivalents(config: Any | None = None) -> dict[str, str]:
    """Load MCP → built-in equivalence map from config."""
    if config is None:
        from .config import get_config
        config = get_config()
    return dict(config.mcp_to_builtin)


# ── Lazy-cached accessors ──────────────────────────────────────────────────
# These caches avoid re-creating on every call but respect config changes.

_cached_builtins: dict[str, ToolCapability] | None = None
_cached_equivalents: dict[str, str] | None = None


def _get_builtins(config: Any | None = None) -> dict[str, ToolCapability]:
    global _cached_builtins
    if _cached_builtins is None:
        _cached_builtins = _load_builtin_tools(config)
    return _cached_builtins


def _get_equivalents(config: Any | None = None) -> dict[str, str]:
    global _cached_equivalents
    if _cached_equivalents is None:
        _cached_equivalents = _load_mcp_equivalents(config)
    return _cached_equivalents


def reload_registry(config: Any | None = None) -> None:
    """Force reload the tool registry from config. Call after config changes."""
    global _cached_builtins, _cached_equivalents
    _cached_builtins = _load_builtin_tools(config)
    _cached_equivalents = _load_mcp_equivalents(config)


# ── Public accessors (backward compat) ──────────────────────────────────────

@property
def BUILTIN_TOOLS() -> dict[str, ToolCapability]:
    return _get_builtins()

@property
def MCP_TO_BUILTIN() -> dict[str, str]:
    return _get_equivalents()


# ── Intent-to-Tool Matching ────────────────────────────────────────────────

def _tokenize(text: str) -> set[str]:
    """Extract lowercase word tokens from text."""
    return set(re.findall(r"[a-z]+", text.lower()))


def select_tools(
    task: str,
    extra_tools: dict[str, ToolCapability] | None = None,
    connected_mcp_servers: set[str] | None = None,
    max_tools: int = 5,
    config: Any | None = None,
) -> list[ToolMatch]:
    """
    Match task intent to available tools. Always prefers built-in tools.

    All tool registrations come from config — not hardcoded.

    Args:
        task: The task description to analyze
        extra_tools: Additional tools (from MCP discovery)
        connected_mcp_servers: Set of already-connected MCP server names
        max_tools: Maximum number of tools to return
        config: Optional MMCPConfig

    Returns:
        List of ToolMatch sorted by: relevance × (1 / cost_weight)
    """
    builtins = _get_builtins(config)
    equivalents = _get_equivalents(config)
    connected = connected_mcp_servers or set()
    task_tokens = _tokenize(task)
    all_tools = dict(builtins)

    if extra_tools:
        all_tools.update(extra_tools)

    matches: list[ToolMatch] = []

    for name, cap in all_tools.items():
        # Check for MCP → built-in equivalence
        if cap.source.startswith("mcp:") and name in equivalents:
            continue

        # Calculate relevance score
        tag_tokens = set(cap.tags)
        desc_tokens = _tokenize(cap.description)
        all_cap_tokens = tag_tokens | desc_tokens

        overlap = task_tokens & all_cap_tokens
        if not overlap:
            continue

        relevance = len(overlap) / max(len(task_tokens), 1)

        # Determine effective tier
        if cap.source.startswith("mcp:"):
            server_name = cap.source.split(":", 1)[1]
            tier = ToolTier.MCP_WARM if server_name in connected else ToolTier.MCP_COLD
        else:
            tier = cap.tier

        # Cost multiplier (built-in gets 10x preference)
        cost_multiplier = {
            ToolTier.BUILTIN: 1.0,
            ToolTier.MCP_WARM: 0.5,
            ToolTier.MCP_COLD: 0.1,
            ToolTier.LLM_TOOL: 0.3,
        }[tier]

        adjusted_score = relevance * cost_multiplier

        matches.append(ToolMatch(
            tool_name=name,
            source=cap.source,
            tier=tier,
            relevance_score=round(adjusted_score, 3),
            cost_per_call=cap.cost_per_call,
            avg_latency_ms=cap.avg_latency_ms,
            tags=list(overlap),
        ))

    matches.sort(key=lambda m: m.relevance_score, reverse=True)
    return matches[:max_tools]


def resolve_tool(
    tool_name: str,
    source_hint: str = "",
    config: Any | None = None,
) -> tuple[str, str]:
    """
    Resolve a tool name to the best execution target.
    Always prefers built-in equivalents.
    """
    equivalents = _get_equivalents(config)
    builtins = _get_builtins(config)

    if tool_name in equivalents:
        return equivalents[tool_name], "builtin"
    if tool_name in builtins:
        return tool_name, "builtin"
    return tool_name, source_hint or "mcp:unknown"


def build_tool_context(matches: list[ToolMatch], config: Any | None = None) -> str:
    """
    Build tool availability context for injection into the planner prompt.
    Uses compact format when token optimization is enabled.
    """
    if not matches:
        return ""

    if config is None:
        from .config import get_config
        config = get_config()

    builtins = _get_builtins(config)

    # Compact format for token optimization
    if config.compact_system_prompts:
        lines = ["## Tools (prefer built-in):"]
        for m in matches:
            tier_label = {
                ToolTier.BUILTIN: "FREE",
                ToolTier.MCP_WARM: "MCP-warm",
                ToolTier.MCP_COLD: "MCP-cold",
                ToolTier.LLM_TOOL: "LLM",
            }[m.tier]
            cap = builtins.get(m.tool_name)
            desc = cap.description if cap else ""
            lines.append(f"- {m.tool_name} [{tier_label}]: {desc}")
        lines.append("PREFER built-in (FREE) over MCP tools.")
        return "\n".join(lines)

    # Verbose format
    lines = ["## Available Tools (auto-discovered, prefer built-in):", ""]
    for m in matches:
        tier_label = {
            ToolTier.BUILTIN: "FREE/instant",
            ToolTier.MCP_WARM: "MCP (connected)",
            ToolTier.MCP_COLD: "MCP (needs startup, ~3s)",
            ToolTier.LLM_TOOL: "LLM-backed",
        }[m.tier]
        cap = builtins.get(m.tool_name)
        desc = cap.description if cap else ""
        params = cap.parameters if cap else {}
        lines.append(f"- **{m.tool_name}** [{tier_label}]: {desc}")
        if params:
            param_str = ", ".join(f'{k}: {v}' for k, v in params.items())
            lines.append(f"  Parameters: {param_str}")

    lines.extend(["", "IMPORTANT: Prefer built-in tools over MCP tools.",
                   "Only use MCP tools when no built-in equivalent exists."])
    return "\n".join(lines)


# ── MCP Tool Discovery ─────────────────────────────────────────────────────

async def discover_mcp_tools(
    clients: dict,
    config: Any | None = None,
) -> dict[str, ToolCapability]:
    """Discover tools from connected MCP servers."""
    equivalents = _get_equivalents(config)
    discovered: dict[str, ToolCapability] = {}

    for server_name, client in clients.items():
        if not client.connected:
            continue
        try:
            tools = await client.list_tools()
            for tool in tools:
                desc_tokens = _tokenize(tool.description)
                builtin_equiv = equivalents.get(tool.name)
                key = f"mcp:{server_name}:{tool.name}"
                discovered[key] = ToolCapability(
                    name=tool.name,
                    description=tool.description,
                    tags=list(desc_tokens),
                    tier=ToolTier.MCP_WARM,
                    cost_per_call=0.001,
                    avg_latency_ms=50 if not builtin_equiv else 3000,
                    source=f"mcp:{server_name}",
                    parameters={
                        k: str(v) for k, v in tool.input_schema.get("properties", {}).items()
                    },
                )
        except Exception:
            continue

    return discovered


# ── MCP Connection Pool ─────────────────────────────────────────────────────

class MCPConnectionPool:
    """
    Lazy-init connection pool for MCP servers.
    Server configs come from MMCPConfig — not hardcoded.
    """

    def __init__(
        self,
        idle_timeout_s: float = 300.0,
        config: Any | None = None,
    ) -> None:
        if config is None:
            from .config import get_config
            config = get_config()

        self._config = config
        self._connections: dict[str, Any] = {}
        self._last_used: dict[str, float] = {}
        self._startup_times: dict[str, int] = {}
        self._metrics: list[MCPCallMetrics] = []
        self.idle_timeout_s = idle_timeout_s

    @property
    def connected_servers(self) -> set[str]:
        return {
            name for name, client in self._connections.items()
            if client.connected
        }

    async def get_or_connect(self, server_name: str) -> Any:
        """Return existing connection or lazily start one."""
        from .mcp_client import MCPClient

        existing = self._connections.get(server_name)
        if existing and existing.connected:
            self._last_used[server_name] = time.time()
            return existing

        # Server config from config — not hardcoded
        servers = self._config.mcp_servers
        server_cfg = servers.get(server_name)
        if not server_cfg:
            raise ValueError(
                f"Unknown MCP server: {server_name}. "
                f"Available: {list(servers.keys())}. "
                f"Add it to config: tools.mcp_servers.{server_name}"
            )

        client = MCPClient()
        start = time.monotonic()
        await client.connect(
            server_cfg["command"],
            server_cfg.get("args", []),
            server_cfg.get("env"),
        )
        startup_ms = int((time.monotonic() - start) * 1000)

        self._connections[server_name] = client
        self._last_used[server_name] = time.time()
        self._startup_times[server_name] = startup_ms
        return client

    async def call_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: dict,
    ) -> tuple[str, MCPCallMetrics]:
        """Call a tool with built-in preference and metrics tracking."""
        equivalents = _get_equivalents(self._config)
        builtin_equiv = equivalents.get(tool_name)

        if builtin_equiv:
            from .tools import execute_tool
            start = time.monotonic()
            result = await execute_tool(builtin_equiv, arguments)
            latency = int((time.monotonic() - start) * 1000)
            metrics = MCPCallMetrics(
                server_name=server_name, tool_name=tool_name,
                startup_ms=0, call_latency_ms=latency,
                was_pool_hit=True, builtin_equivalent=builtin_equiv,
            )
            self._metrics.append(metrics)
            return result, metrics

        was_connected = server_name in self._connections and self._connections[server_name].connected
        client = await self.get_or_connect(server_name)
        startup_ms = 0 if was_connected else self._startup_times.get(server_name, 0)

        start = time.monotonic()
        result = await client.call_tool(tool_name, arguments)
        call_latency = int((time.monotonic() - start) * 1000)

        metrics = MCPCallMetrics(
            server_name=server_name, tool_name=tool_name,
            startup_ms=startup_ms, call_latency_ms=call_latency,
            was_pool_hit=was_connected, builtin_equivalent=None,
        )
        self._metrics.append(metrics)
        return result, metrics

    async def disconnect_idle(self) -> list[str]:
        now = time.time()
        disconnected = []
        for name, last in list(self._last_used.items()):
            if now - last > self.idle_timeout_s:
                client = self._connections.get(name)
                if client and client.connected:
                    await client.disconnect()
                    disconnected.append(name)
                self._connections.pop(name, None)
                self._last_used.pop(name, None)
        return disconnected

    async def disconnect_all(self) -> None:
        for client in self._connections.values():
            if client.connected:
                await client.disconnect()
        self._connections.clear()
        self._last_used.clear()

    def get_metrics(self) -> list[MCPCallMetrics]:
        return list(self._metrics)

    def get_overhead_summary(self) -> dict:
        if not self._metrics:
            return {"total_calls": 0, "total_startup_ms": 0, "pool_hit_rate": 0.0, "builtin_redirects": 0}
        total_startup = sum(m.startup_ms for m in self._metrics)
        pool_hits = sum(1 for m in self._metrics if m.was_pool_hit)
        builtin_redirects = sum(1 for m in self._metrics if m.builtin_equivalent)
        return {
            "total_calls": len(self._metrics),
            "total_startup_ms": total_startup,
            "avg_startup_ms": total_startup // max(len(self._metrics), 1),
            "pool_hit_rate": round(pool_hits / len(self._metrics), 2),
            "builtin_redirects": builtin_redirects,
            "cold_starts": sum(1 for m in self._metrics if not m.was_pool_hit and not m.builtin_equivalent),
        }
