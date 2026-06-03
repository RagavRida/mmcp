# mmcp-core MCP Server

An MCP (Model Context Protocol) server that gives **Claude Desktop** and **OpenAI Codex CLI** access to MMCP's intelligent multi-model routing, cost optimization, and autonomous pipeline capabilities.

## What This Does

When you add `mmcp-core` as an MCP server, your AI assistant gains these superpowers:

| Tool | What it does |
|---|---|
| `analyze_task` | Classify complexity → recommend the optimal model (with justification) |
| `plan_task` | Decompose a task into executable steps with per-step model selection |
| `execute_task` | Full autonomous pipeline: plan → route → execute → return results |
| `select_tools_for_task` | Auto-discover the best tools (prefers free built-ins over MCP) |
| `cost_summary` | Spending analysis over any period |
| `cost_savings` | Actionable recommendations to reduce AI spend |
| `set_budget` | Set daily spend cap (auto-downgrades models when approaching limit) |
| `model_value_report` | Which models create value vs. which are overkill |
| `list_skills` | List saved reusable pipeline skills |
| `configure` | View/update all MMCP settings |

## Quick Setup

### 1. Install

```bash
pip install mmcp-core[mcp-server]
```

Or install from source:

```bash
cd python/
pip install -e ".[mcp-server]"
```

### 2. Set your API key

```bash
export OPENROUTER_API_KEY="sk-or-..."
```

### 3. Configure your client

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mmcp-core": {
      "command": "python",
      "args": ["-m", "mmcp_mcp_server"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-your-key-here"
      }
    }
  }
}
```

Then restart Claude Desktop.

#### Codex CLI

```bash
# One-liner
codex mcp add mmcp-core -- python -m mmcp_mcp_server

# Or edit ~/.codex/config.toml:
[mcp_servers.mmcp-core]
command = "python"
args = ["-m", "mmcp_mcp_server"]
```

#### Any MCP Client (stdio)

```bash
# Start the server
python -m mmcp_mcp_server

# Or use the CLI entry point
mmcp-mcp-server
```

## Example Interactions

### With Claude Desktop

> **You**: "I need to analyze a machine learning paper and write a summary. What model should I use?"
>
> **Claude** *(using analyze_task)*: "This is a COMPLEX task in the analysis domain. I recommend `anthropic/claude-sonnet-4` (est. $0.003). Alternative: `claude-3.5-haiku` saves 85% but may miss nuanced analysis."

> **You**: "What am I spending on AI this month?"
>
> **Claude** *(using cost_summary)*: "Total: $12.47 across 342 calls. Top model: deepseek-r1 ($5.23). Savings opportunity: downgrade opus for trivial tasks → save $3.80."

### With Codex CLI

> **You**: "Plan a task to research and write a technical blog post about WebAssembly"
>
> **Codex** *(using plan_task)*: Creates a 4-step plan:
> 1. 🔍 Web search for WebAssembly trends → `web_search` (FREE)
> 2. 📊 Analyze results → `deepseek-r1` (COMPLEX, $0.002)
> 3. ✍️ Write blog post → `claude-sonnet-4` (STANDARD, $0.004)
> 4. ✅ Review and polish → `claude-3.5-haiku` (TRIVIAL, $0.0003)

## Configuration

MMCP is fully configurable. Create `~/.mmcp/config.yaml`:

```yaml
models:
  pricing:
    my-org/custom-model:
      input: 0.5
      output: 1.0

routing:
  default_model: anthropic/claude-3.5-haiku
  epsilon: 0.05

tokens:
  compact_system_prompts: true
  max_context_injection_tokens: 1500

budget:
  daily_usd: 5.0

tools:
  builtin:
    my_rag_tool:
      description: "Search internal knowledge base"
      tags: [rag, search, knowledge]
      cost_per_call: 0.0
      avg_latency_ms: 200
```

Or use environment variables:

```bash
export MMCP_DEFAULT_MODEL="anthropic/claude-3.5-haiku"
export MMCP_DAILY_BUDGET="5.0"
export MMCP_COMPACT_PROMPTS="true"
```

## Architecture

```
┌──────────────────┐     stdio      ┌──────────────────────────┐
│  Claude Desktop  │ ◄──────────── │  mmcp-core MCP Server    │
│  or Codex CLI    │ ──────────── ►│                          │
└──────────────────┘    JSON-RPC    │  ┌─ SmartRouter ────────┐│
                                    │  │  Complexity → Model  ││
                                    │  │  RL feedback loop    ││
                                    │  └──────────────────────┘│
                                    │  ┌─ CostOptimizer ──────┐│
                                    │  │  Expense tracking    ││
                                    │  │  Savings engine      ││
                                    │  └──────────────────────┘│
                                    │  ┌─ ToolSelector ───────┐│
                                    │  │  Built-in preference ││
                                    │  │  MCP equivalence     ││
                                    │  └──────────────────────┘│
                                    │  ┌─ Planner + Executor ─┐│
                                    │  │  Task decomposition  ││
                                    │  │  Context chaining    ││
                                    │  └──────────────────────┘│
                                    └──────────────────────────┘
                                              │
                                    ┌─────────┼─────────┐
                                    ▼         ▼         ▼
                              OpenRouter   Built-in  ~/.mmcp/
                              (models)     tools     (config)
```

## Development

```bash
# Install in development mode
cd python/
pip install -e ".[mcp-server,dev]"

# Test the server
python -m mmcp_mcp_server

# Run tests
pytest tests/
```
