# MMCP Architecture & Configuration

## Configuration System

MMCP uses a central config system (`mmcp_core/config.py`). **Nothing is hardcoded** — every value is overridable.

### Config Load Priority

```
defaults → ~/.mmcp/config.yaml → env vars → programmatic overrides
```

### Config File Location

Searched in order:
1. `~/.mmcp/config.yaml`
2. `~/.mmcp/config.json`
3. `./mmcp.yaml` (project-local)
4. `./mmcp.json` (project-local)

### Full Config Schema

```yaml
# ~/.mmcp/config.yaml

models:
  # Model pricing (USD per 1M tokens)
  pricing:
    anthropic/claude-opus-4:        { input: 15, output: 75 }
    anthropic/claude-sonnet-4:      { input: 3, output: 15 }
    anthropic/claude-3.5-haiku:     { input: 0.25, output: 1.25 }
    google/gemini-2.5-pro-preview:  { input: 1.25, output: 5 }
    google/gemini-2.5-flash:        { input: 0.15, output: 0.6 }
    deepseek/deepseek-r1:           { input: 0.55, output: 2.19 }
    meta-llama/llama-4-maverick:    { input: 0.20, output: 0.60 }
    openai/gpt-4o:                  { input: 2.5, output: 10 }
    openai/gpt-4o-mini:             { input: 0.15, output: 0.6 }
    # Add custom models here:
    my-org/custom-model:            { input: 0.5, output: 1.0 }

  # Models per complexity tier
  tiers:
    trivial:  [meta-llama/llama-4-maverick, anthropic/claude-3.5-haiku]
    standard: [anthropic/claude-3.5-haiku, google/gemini-2.5-flash]
    complex:  [anthropic/claude-sonnet-4, google/gemini-2.5-pro-preview]
    frontier: [deepseek/deepseek-r1, anthropic/claude-opus-4]

  # Domain-specific model preferences
  domain_preferences:
    math_reasoning:   { complex: deepseek/deepseek-r1, frontier: deepseek/deepseek-r1 }
    code_generation:  { complex: anthropic/claude-sonnet-4, frontier: google/gemini-2.5-pro-preview }
    creative_writing: { standard: anthropic/claude-sonnet-4 }
    security:         { frontier: anthropic/claude-opus-4 }

  # Action type → default model mapping
  actions:
    research:  deepseek/deepseek-r1
    analyze:   deepseek/deepseek-r1
    code:      google/gemini-2.5-pro-preview
    write:     anthropic/claude-sonnet-4
    review:    anthropic/claude-3.5-haiku
    summarize: anthropic/claude-3.5-haiku
    translate: meta-llama/llama-4-maverick
    math:      deepseek/deepseek-r1
    tool:      null  # No model, direct tool call

routing:
  default_model: anthropic/claude-3.5-haiku
  planner_model: anthropic/claude-3.5-haiku
  default_endpoint: https://openrouter.ai/api/v1/chat/completions
  weights: { accuracy: 0.5, latency: 0.3, cost: 0.2 }
  epsilon: 0.10         # RL exploration rate
  epsilon_decay: 0.995  # Decay per invocation
  epsilon_min: 0.01     # Minimum exploration

tokens:
  max_context_injection_tokens: 2000  # Max tokens injected from dep steps
  max_output_tokens_per_step: 4096
  max_plan_steps: 8
  truncation_strategy: tail   # head, tail, middle
  compact_system_prompts: true
  estimate_ratio: 4           # chars per token estimate

tools:
  builtin:
    web_search: { description: "Search the web", tags: [search, web], cost_per_call: 0.0, avg_latency_ms: 500 }
    http_request: { description: "HTTP request", tags: [api, http], cost_per_call: 0.0, avg_latency_ms: 1000 }
    read_file: { description: "Read a file", tags: [file, read], cost_per_call: 0.0, avg_latency_ms: 5 }
    write_file: { description: "Write a file", tags: [file, write], cost_per_call: 0.0, avg_latency_ms: 5 }
    run_command: { description: "Shell command", tags: [shell, command], cost_per_call: 0.0, avg_latency_ms: 100 }
    # Add custom tools:
    my_rag_tool: { description: "RAG search", tags: [rag, search], cost_per_call: 0.0, avg_latency_ms: 200 }

  mcp_equivalents:
    read_file: read_file      # MCP filesystem → built-in
    write_file: write_file
    fetch: http_request       # MCP fetch → built-in

  mcp_servers:
    filesystem: { command: npx, args: [-y, "@anthropic-ai/mcp-server-filesystem", "~"] }
    fetch: { command: npx, args: [-y, "@anthropic-ai/mcp-server-fetch"] }
    github: { command: npx, args: [-y, "@anthropic-ai/mcp-server-github"] }

budget:
  daily_usd: null  # No cap by default

storage:
  home: ~/.mmcp
  expenses_dir: ~/.mmcp/expenses
  skills_dir: ~/.mmcp/skills
```

### Environment Variables

| Variable | Config Path | Example |
|---|---|---|
| `MMCP_DEFAULT_MODEL` | `routing.default_model` | `anthropic/claude-3.5-haiku` |
| `MMCP_PLANNER_MODEL` | `routing.planner_model` | `anthropic/claude-3.5-haiku` |
| `MMCP_ENDPOINT` | `routing.default_endpoint` | `https://openrouter.ai/...` |
| `MMCP_DAILY_BUDGET` | `budget.daily_usd` | `5.0` |
| `MMCP_MAX_TOKENS` | `tokens.max_output_tokens_per_step` | `4096` |
| `MMCP_MAX_CONTEXT_TOKENS` | `tokens.max_context_injection_tokens` | `2000` |
| `MMCP_COMPACT_PROMPTS` | `tokens.compact_system_prompts` | `true` |
| `MMCP_HOME` | `storage.home` | `~/.mmcp` |
| `OPENROUTER_API_KEY` | — | `sk-or-...` (required) |

### Programmatic API

```python
from mmcp_core import MMCPConfig, set_config

# Override specific values
config = MMCPConfig(
    models={"pricing": {"my-model": {"input": 1, "output": 2}}},
    routing={"default_model": "my-model"},
    budget={"daily_usd": 5.0},
)
set_config(config)

# Auto-load (file + env + defaults)
config = MMCPConfig.auto()

# Minimal (just defaults, no file loading)
config = MMCPConfig.minimal()

# From specific file
config = MMCPConfig.from_file("./my-config.yaml")
```

## Core Types

Key types defined in `mmcp_core/types.py`:

| Type | Values | Purpose |
|---|---|---|
| `TaskComplexity` | `TRIVIAL`, `STANDARD`, `COMPLEX`, `FRONTIER` | Task difficulty tier |
| `ToolTier` | `BUILTIN`, `MCP_WARM`, `MCP_COLD`, `LLM_TOOL` | Tool cost tier |
| `ModelJustification` | dataclass | Why a model was chosen + alternative |
| `SmartRouteDecision` | dataclass | Full routing result |
| `ExpenseEntry` | dataclass | Single expense record |
| `SpendAnalysis` | dataclass | Spending summary |
| `BudgetStatus` | dataclass | Budget tracking state |

## Pipeline Architecture

```
User Task
    │
    ▼
┌─ Planner ──────────────────────────┐
│  LLM decomposes task → 3-6 steps   │
│  SmartRouter assigns models/step    │
│  ToolSelector discovers tools       │
└─────────────────────────────────────┘
    │
    ▼ ExecutionPlan (PlanStep[])
    │
┌─ Executor ─────────────────────────┐
│  For each step:                     │
│    1. Resolve tool (built-in first) │
│    2. Call model via OpenRouter     │
│    3. Inject dep outputs (truncated)│
│    4. Record expense + RL feedback  │
└─────────────────────────────────────┘
    │
    ▼ MMCPRunResult
```
