"""
MMCP v2.2 — Centralized Configuration.

All configurable values in one place. Nothing hardcoded.
Developers can override via:
  1. Programmatic API:  MMCPConfig(models={...}, routing={...})
  2. Config file:       ~/.mmcp/config.yaml or ~/.mmcp/config.json
  3. Environment vars:  MMCP_DAILY_BUDGET, MMCP_DEFAULT_MODEL, etc.
  4. Constructor args:  SmartRouter(config=my_config)

Config is loaded with a merge strategy:
  defaults → config file → env vars → programmatic overrides
"""
from __future__ import annotations
import json
import os
from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .types import TaskComplexity


# ── Paths ───────────────────────────────────────────────────────────────────

MMCP_DIR = Path(os.environ.get("MMCP_HOME", str(Path.home() / ".mmcp")))
CONFIG_PATHS = [
    MMCP_DIR / "config.yaml",
    MMCP_DIR / "config.json",
    Path("mmcp.yaml"),         # project-local
    Path("mmcp.json"),         # project-local
]


# ── Default Configuration ───────────────────────────────────────────────────
# These are the sensible defaults. Every single value can be overridden.

_DEFAULT_MODEL_PRICING: dict[str, dict[str, float]] = {
    # Anthropic
    "anthropic/claude-opus-4":          {"input": 15,    "output": 75},
    "anthropic/claude-sonnet-4":        {"input": 3,     "output": 15},
    "anthropic/claude-3.5-haiku":       {"input": 0.25,  "output": 1.25},
    # Google
    "google/gemini-2.5-pro-preview":    {"input": 1.25,  "output": 5},
    "google/gemini-2.5-flash":          {"input": 0.15,  "output": 0.6},
    # DeepSeek
    "deepseek/deepseek-r1":             {"input": 0.55,  "output": 2.19},
    # Meta
    "meta-llama/llama-4-maverick":      {"input": 0.20,  "output": 0.60},
    # OpenAI
    "openai/gpt-4o":                    {"input": 2.5,   "output": 10},
    "openai/gpt-4o-mini":               {"input": 0.15,  "output": 0.6},
}

_DEFAULT_COMPLEXITY_MODELS: dict[str, list[str]] = {
    "trivial":  ["meta-llama/llama-4-maverick", "anthropic/claude-3.5-haiku", "google/gemini-2.5-flash"],
    "standard": ["anthropic/claude-3.5-haiku", "google/gemini-2.5-flash", "openai/gpt-4o-mini"],
    "complex":  ["anthropic/claude-sonnet-4", "google/gemini-2.5-pro-preview", "openai/gpt-4o"],
    "frontier": ["deepseek/deepseek-r1", "anthropic/claude-opus-4", "anthropic/claude-sonnet-4"],
}

_DEFAULT_DOMAIN_PREFERENCES: dict[str, dict[str, str]] = {
    "math_reasoning":   {"complex": "deepseek/deepseek-r1", "frontier": "deepseek/deepseek-r1"},
    "code_generation":  {"complex": "anthropic/claude-sonnet-4", "frontier": "google/gemini-2.5-pro-preview"},
    "creative_writing": {"standard": "anthropic/claude-sonnet-4", "complex": "anthropic/claude-sonnet-4"},
    "security":         {"complex": "anthropic/claude-sonnet-4", "frontier": "anthropic/claude-opus-4"},
}

_DEFAULT_ACTION_TO_MODEL: dict[str, str | None] = {
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
    "tool":       None,
    "mcp":        None,
}

_DEFAULT_ACTION_COMPLEXITY: dict[str, str] = {
    "research":   "complex",
    "analyze":    "complex",
    "code":       "complex",
    "generate":   "standard",
    "write":      "standard",
    "review":     "standard",
    "summarize":  "trivial",
    "translate":  "trivial",
    "quick":      "trivial",
    "math":       "frontier",
    "creative":   "standard",
}

_DEFAULT_DOMAIN_KEYWORDS: dict[str, list[str]] = {
    "code_generation": [
        "code", "function", "implement", "program", "debug", "fix bug",
        "refactor", "api", "endpoint", "class", "module", "script",
        "python", "javascript", "typescript", "rust", "go", "java",
    ],
    "code_review": [
        "review", "audit", "inspect", "lint", "quality", "bug",
        "vulnerability", "code smell",
    ],
    "math_reasoning": [
        "math", "prove", "theorem", "calculus", "equation", "formula",
        "calculate", "derivative", "integral", "probability", "statistics",
        "algebra", "geometry", "linear algebra",
    ],
    "creative_writing": [
        "write", "blog", "story", "essay", "poem", "creative",
        "narrative", "article", "fiction", "screenplay",
    ],
    "analysis": [
        "analyze", "compare", "evaluate", "assess", "pros", "cons",
        "tradeoff", "benchmark", "performance",
    ],
    "planning": [
        "plan", "design", "architect", "strategy", "roadmap",
        "structure", "system design", "proposal",
    ],
    "summarization": [
        "summarize", "summary", "condense", "tldr", "brief", "recap",
        "digest", "key points",
    ],
    "security": [
        "security", "vulnerability", "exploit", "injection", "auth",
        "encrypt", "pentest", "xss", "csrf", "sql injection",
    ],
}

_DEFAULT_COMPLEXITY_SIGNALS: dict[str, list[str]] = {
    "frontier": [
        "prove", "theorem", "proof", "formal verification",
        "security audit", "penetration test", "pentest", "exploit",
        "system design", "distributed system", "architecture design",
        "research paper", "literature review", "state of the art",
        "mathematical proof", "derive", "derivation",
        "optimize algorithm", "computational complexity",
        "deep analysis", "comprehensive analysis",
        "multi-step reasoning", "chain of thought",
        "from scratch", "implement from first principles",
    ],
    "complex": [
        "implement", "build", "create", "develop", "architect",
        "refactor", "redesign", "migrate",
        "debug", "troubleshoot", "root cause",
        "compare and contrast", "trade-off", "tradeoff",
        "design pattern", "api design",
        "code review", "security review",
        "multi-file", "full stack", "end to end",
        "integrate", "integration",
        "write tests", "test suite",
        "explain in detail", "step by step",
        "analyze", "evaluate", "assess",
    ],
    "standard": [
        "write", "draft", "compose", "describe",
        "summarize", "summary", "brief",
        "convert", "transform", "format",
        "list", "enumerate", "outline",
        "generate", "create a",
        "blog post", "article", "essay",
        "email", "message", "response",
        "explain", "what is", "how does",
    ],
    "trivial": [
        "translate", "translation",
        "hello world", "simple example",
        "fix typo", "fix grammar", "proofread",
        "format", "reformat", "prettify",
        "rename", "replace", "find and replace",
        "yes or no", "true or false",
        "one word", "one sentence", "short answer",
        "echo", "repeat", "copy",
        "what time", "what date", "current",
        "count", "how many",
    ],
}

_DEFAULT_DOMAIN_COMPLEXITY_FLOOR: dict[str, str] = {
    "math_reasoning": "complex",
    "security": "complex",
    "planning": "standard",
    "code_generation": "standard",
}

_DEFAULT_MCP_TO_BUILTIN: dict[str, str] = {
    "read_file": "read_file",
    "write_file": "write_file",
    "list_directory": "run_command",
    "create_directory": "run_command",
    "get_file_info": "run_command",
    "fetch": "http_request",
}

_DEFAULT_MCP_SERVERS: dict[str, dict[str, Any]] = {
    "filesystem": {
        "command": "npx",
        "args": ["-y", "@anthropic-ai/mcp-server-filesystem", "~"],
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
    },
}

_DEFAULT_BUILTIN_TOOLS: dict[str, dict[str, Any]] = {
    "web_search": {
        "description": "Search the web using DuckDuckGo (free, no API key needed)",
        "tags": ["search", "web", "query", "research", "lookup", "find", "internet", "google"],
        "cost_per_call": 0.0,
        "avg_latency_ms": 500,
        "parameters": {"query": "Search query string"},
    },
    "http_request": {
        "description": "Make an HTTP request to any URL",
        "tags": ["api", "http", "rest", "fetch", "download", "webhook", "url", "request"],
        "cost_per_call": 0.0,
        "avg_latency_ms": 1000,
        "parameters": {"method": "GET/POST/PUT/DELETE", "url": "Target URL", "body": "Optional JSON body"},
    },
    "read_file": {
        "description": "Read contents of a local file",
        "tags": ["file", "read", "load", "open", "content", "local", "disk"],
        "cost_per_call": 0.0,
        "avg_latency_ms": 5,
        "parameters": {"path": "Absolute or relative file path"},
    },
    "write_file": {
        "description": "Write content to a local file",
        "tags": ["file", "write", "save", "create", "output", "local", "disk"],
        "cost_per_call": 0.0,
        "avg_latency_ms": 5,
        "parameters": {"path": "File path", "content": "Content to write"},
    },
    "run_command": {
        "description": "Run a shell command (allowlisted only)",
        "tags": ["shell", "command", "execute", "run", "terminal", "bash", "cli"],
        "cost_per_call": 0.0,
        "avg_latency_ms": 100,
        "parameters": {"command": "Shell command to execute"},
    },
}


# ── Token Optimization Defaults ─────────────────────────────────────────────

_DEFAULT_TOKEN_CONFIG: dict[str, Any] = {
    "max_context_injection_tokens": 2000,  # Max tokens to inject from dep steps
    "max_output_tokens_per_step": 4096,    # Default max output per step
    "max_plan_steps": 8,                   # Max steps in auto-generated plans
    "truncation_strategy": "tail",         # "head", "tail", "middle"
    "compact_system_prompts": True,        # Use shorter system prompts
    "estimate_ratio": 4,                   # chars-per-token estimate (no tiktoken dep)
    "context_budget_pct": 0.25,            # Max 25% of context window for dep injection
}


# ── Routing Defaults ────────────────────────────────────────────────────────

_DEFAULT_ROUTING_CONFIG: dict[str, Any] = {
    "weights": {"accuracy": 0.5, "latency": 0.3, "cost": 0.2},
    "epsilon": 0.10,
    "epsilon_decay": 0.995,
    "epsilon_min": 0.01,
    "ucb_c": 1.41,
    "default_model": "anthropic/claude-3.5-haiku",
    "planner_model": "anthropic/claude-3.5-haiku",
    "default_endpoint": "https://openrouter.ai/api/v1/chat/completions",
}


# ── Main Config Class ──────────────────────────────────────────────────────

class MMCPConfig:
    """
    Central configuration for MMCP. Everything is overridable.

    Usage:
        # Use defaults
        config = MMCPConfig()

        # Override specific values
        config = MMCPConfig(
            models={"pricing": {"my-model/v1": {"input": 1, "output": 2}}},
            tokens={"max_context_injection_tokens": 1000},
            routing={"default_model": "my-model/v1"},
        )

        # Load from file
        config = MMCPConfig.from_file("~/.mmcp/config.yaml")

        # Auto-load (file + env + defaults merged)
        config = MMCPConfig.auto()
    """

    def __init__(
        self,
        models: dict[str, Any] | None = None,
        routing: dict[str, Any] | None = None,
        tokens: dict[str, Any] | None = None,
        tools: dict[str, Any] | None = None,
        complexity: dict[str, Any] | None = None,
        budget: dict[str, Any] | None = None,
        storage: dict[str, Any] | None = None,
    ) -> None:
        # ── Models ──────────────────────────────────────────────
        models = models or {}
        self.model_pricing: dict[str, dict[str, float]] = _deep_merge(
            deepcopy(_DEFAULT_MODEL_PRICING),
            models.get("pricing", {}),
        )
        self.complexity_models: dict[str, list[str]] = _deep_merge(
            deepcopy(_DEFAULT_COMPLEXITY_MODELS),
            models.get("tiers", {}),
        )
        self.domain_preferences: dict[str, dict[str, str]] = _deep_merge(
            deepcopy(_DEFAULT_DOMAIN_PREFERENCES),
            models.get("domain_preferences", {}),
        )
        self.action_to_model: dict[str, str | None] = _deep_merge(
            deepcopy(_DEFAULT_ACTION_TO_MODEL),
            models.get("actions", {}),
        )
        self.action_complexity: dict[str, str] = _deep_merge(
            deepcopy(_DEFAULT_ACTION_COMPLEXITY),
            models.get("action_complexity", {}),
        )

        # ── Routing ─────────────────────────────────────────────
        routing = routing or {}
        _routing = _deep_merge(deepcopy(_DEFAULT_ROUTING_CONFIG), routing)
        self.routing_weights: dict[str, float] = _routing["weights"]
        self.epsilon: float = _routing["epsilon"]
        self.epsilon_decay: float = _routing["epsilon_decay"]
        self.epsilon_min: float = _routing["epsilon_min"]
        self.ucb_c: float = _routing["ucb_c"]
        self.default_model: str = _routing["default_model"]
        self.planner_model: str = _routing["planner_model"]
        self.default_endpoint: str = _routing["default_endpoint"]

        # ── Tokens (Optimization) ───────────────────────────────
        tokens = tokens or {}
        _tokens = _deep_merge(deepcopy(_DEFAULT_TOKEN_CONFIG), tokens)
        self.max_context_injection_tokens: int = _tokens["max_context_injection_tokens"]
        self.max_output_tokens_per_step: int = _tokens["max_output_tokens_per_step"]
        self.max_plan_steps: int = _tokens["max_plan_steps"]
        self.truncation_strategy: str = _tokens["truncation_strategy"]
        self.compact_system_prompts: bool = _tokens["compact_system_prompts"]
        self.token_estimate_ratio: int = _tokens["estimate_ratio"]
        self.context_budget_pct: float = _tokens["context_budget_pct"]

        # ── Tools ───────────────────────────────────────────────
        tools = tools or {}
        self.builtin_tools: dict[str, dict[str, Any]] = _deep_merge(
            deepcopy(_DEFAULT_BUILTIN_TOOLS),
            tools.get("builtin", {}),
        )
        self.mcp_to_builtin: dict[str, str] = _deep_merge(
            deepcopy(_DEFAULT_MCP_TO_BUILTIN),
            tools.get("mcp_equivalents", {}),
        )
        self.mcp_servers: dict[str, dict[str, Any]] = _deep_merge(
            deepcopy(_DEFAULT_MCP_SERVERS),
            tools.get("mcp_servers", {}),
        )

        # ── Complexity ──────────────────────────────────────────
        complexity = complexity or {}
        self.complexity_signals: dict[str, list[str]] = _deep_merge(
            deepcopy(_DEFAULT_COMPLEXITY_SIGNALS),
            complexity.get("signals", {}),
        )
        self.domain_keywords: dict[str, list[str]] = _deep_merge(
            deepcopy(_DEFAULT_DOMAIN_KEYWORDS),
            complexity.get("domain_keywords", {}),
        )
        self.domain_complexity_floor: dict[str, str] = _deep_merge(
            deepcopy(_DEFAULT_DOMAIN_COMPLEXITY_FLOOR),
            complexity.get("domain_floor", {}),
        )

        # ── Budget ──────────────────────────────────────────────
        budget = budget or {}
        self.daily_budget_usd: float | None = budget.get(
            "daily_usd",
            _env_float("MMCP_DAILY_BUDGET"),
        )

        # ── Storage ─────────────────────────────────────────────
        storage = storage or {}
        self.mmcp_home: Path = Path(storage.get("home", str(MMCP_DIR)))
        self.expenses_dir: Path = Path(storage.get(
            "expenses_dir", str(self.mmcp_home / "expenses"),
        ))
        self.skills_dir: Path = Path(storage.get(
            "skills_dir", str(self.mmcp_home / "skills"),
        ))
        self.budget_file: Path = Path(storage.get(
            "budget_file", str(self.mmcp_home / "budget.json"),
        ))

    # ── Constructors ────────────────────────────────────────────────────

    @classmethod
    def auto(cls) -> MMCPConfig:
        """
        Auto-load configuration: defaults → config file → env vars.
        This is the recommended way to create a config.
        """
        file_data = _load_config_file()
        env_overrides = _load_env_overrides()

        # Merge file config with env overrides
        merged = _deep_merge(file_data, env_overrides)

        return cls(
            models=merged.get("models"),
            routing=merged.get("routing"),
            tokens=merged.get("tokens"),
            tools=merged.get("tools"),
            complexity=merged.get("complexity"),
            budget=merged.get("budget"),
            storage=merged.get("storage"),
        )

    @classmethod
    def from_file(cls, path: str | Path) -> MMCPConfig:
        """Load config from a specific file."""
        data = _read_config(Path(path))
        return cls(
            models=data.get("models"),
            routing=data.get("routing"),
            tokens=data.get("tokens"),
            tools=data.get("tools"),
            complexity=data.get("complexity"),
            budget=data.get("budget"),
            storage=data.get("storage"),
        )

    @classmethod
    def minimal(cls) -> MMCPConfig:
        """Minimal config with just defaults — no file loading."""
        return cls()

    # ── Helpers ──────────────────────────────────────────────────────────

    def estimate_tokens(self, text: str) -> int:
        """Estimate token count without tiktoken dependency."""
        return max(1, len(text) // self.token_estimate_ratio)

    def truncate_to_tokens(self, text: str, max_tokens: int) -> str:
        """Truncate text to approximately max_tokens."""
        max_chars = max_tokens * self.token_estimate_ratio
        if len(text) <= max_chars:
            return text

        if self.truncation_strategy == "head":
            return text[:max_chars] + "\n...[truncated]"
        elif self.truncation_strategy == "tail":
            return "...[truncated]\n" + text[-max_chars:]
        else:  # middle
            half = max_chars // 2
            return text[:half] + "\n...[truncated]...\n" + text[-half:]

    def get_complexity_tier(self, tier_name: str) -> TaskComplexity:
        """Convert string tier name to TaskComplexity enum."""
        return {
            "trivial": TaskComplexity.TRIVIAL,
            "standard": TaskComplexity.STANDARD,
            "complex": TaskComplexity.COMPLEX,
            "frontier": TaskComplexity.FRONTIER,
        }.get(tier_name, TaskComplexity.STANDARD)

    def to_dict(self) -> dict[str, Any]:
        """Serialize config for debugging/export."""
        return {
            "models": {
                "pricing": self.model_pricing,
                "tiers": self.complexity_models,
                "domain_preferences": self.domain_preferences,
                "actions": self.action_to_model,
                "action_complexity": self.action_complexity,
            },
            "routing": {
                "weights": self.routing_weights,
                "epsilon": self.epsilon,
                "default_model": self.default_model,
                "planner_model": self.planner_model,
                "default_endpoint": self.default_endpoint,
            },
            "tokens": {
                "max_context_injection_tokens": self.max_context_injection_tokens,
                "max_output_tokens_per_step": self.max_output_tokens_per_step,
                "max_plan_steps": self.max_plan_steps,
                "truncation_strategy": self.truncation_strategy,
                "compact_system_prompts": self.compact_system_prompts,
            },
            "tools": {
                "builtin": list(self.builtin_tools.keys()),
                "mcp_equivalents": self.mcp_to_builtin,
                "mcp_servers": list(self.mcp_servers.keys()),
            },
            "budget": {
                "daily_usd": self.daily_budget_usd,
            },
        }


# ── File Loading ────────────────────────────────────────────────────────────

def _load_config_file() -> dict:
    """Try to load config from known paths."""
    for path in CONFIG_PATHS:
        if path.exists():
            return _read_config(path)
    return {}


def _read_config(path: Path) -> dict:
    """Read a config file (YAML or JSON)."""
    text = path.read_text(encoding="utf-8")
    if path.suffix in (".yaml", ".yml"):
        try:
            import yaml
            return yaml.safe_load(text) or {}
        except ImportError:
            # YAML not installed — try JSON-like parsing
            return {}
    else:
        return json.loads(text)


def _load_env_overrides() -> dict:
    """Build config overrides from environment variables."""
    overrides: dict[str, Any] = {}

    if os.environ.get("MMCP_DEFAULT_MODEL"):
        overrides.setdefault("routing", {})["default_model"] = os.environ["MMCP_DEFAULT_MODEL"]

    if os.environ.get("MMCP_PLANNER_MODEL"):
        overrides.setdefault("routing", {})["planner_model"] = os.environ["MMCP_PLANNER_MODEL"]

    if os.environ.get("MMCP_ENDPOINT"):
        overrides.setdefault("routing", {})["default_endpoint"] = os.environ["MMCP_ENDPOINT"]

    if os.environ.get("MMCP_DAILY_BUDGET"):
        overrides.setdefault("budget", {})["daily_usd"] = float(os.environ["MMCP_DAILY_BUDGET"])

    if os.environ.get("MMCP_MAX_TOKENS"):
        overrides.setdefault("tokens", {})["max_output_tokens_per_step"] = int(os.environ["MMCP_MAX_TOKENS"])

    if os.environ.get("MMCP_MAX_CONTEXT_TOKENS"):
        overrides.setdefault("tokens", {})["max_context_injection_tokens"] = int(os.environ["MMCP_MAX_CONTEXT_TOKENS"])

    if os.environ.get("MMCP_COMPACT_PROMPTS"):
        overrides.setdefault("tokens", {})["compact_system_prompts"] = os.environ["MMCP_COMPACT_PROMPTS"].lower() in ("1", "true", "yes")

    if os.environ.get("MMCP_HOME"):
        overrides.setdefault("storage", {})["home"] = os.environ["MMCP_HOME"]

    return overrides


# ── Utilities ───────────────────────────────────────────────────────────────

def _deep_merge(base: dict, override: dict) -> dict:
    """Deep merge override into base. Override wins on conflicts."""
    result = dict(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _env_float(name: str) -> float | None:
    """Get float from env, or None."""
    val = os.environ.get(name)
    if val:
        try:
            return float(val)
        except ValueError:
            return None
    return None


# ── Singleton ───────────────────────────────────────────────────────────────

_global_config: MMCPConfig | None = None


def get_config() -> MMCPConfig:
    """Get or create the global config (auto-loaded)."""
    global _global_config
    if _global_config is None:
        _global_config = MMCPConfig.auto()
    return _global_config


def set_config(config: MMCPConfig) -> None:
    """Set the global config."""
    global _global_config
    _global_config = config
