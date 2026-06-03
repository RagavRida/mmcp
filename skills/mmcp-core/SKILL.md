---
name: mmcp-core
description: Use this skill when the user wants to work with MMCP (Multi-Model Context Protocol) — building AI pipelines, configuring intelligent model routing, managing costs, setting up MCP servers for Claude/Codex, or using the MMCP SDK. Covers architecture, configuration, CLI commands, MCP server setup, and all APIs.
---

# MMCP — Multi-Model Context Protocol

MMCP is a framework for orchestrating multiple AI models intelligently. It auto-routes tasks to the optimal model (Claude, GPT, Gemini, DeepSeek, Llama) based on task complexity, tracks costs, and exposes everything as an MCP server for Claude Desktop and Codex CLI.

## When to Use This Skill

- User wants to **build an AI pipeline** that routes to different models
- User wants to **set up the MMCP MCP server** for Claude Desktop or Codex
- User wants to **configure model routing, pricing, or budgets**
- User wants to **optimize AI spending** or understand cost patterns
- User asks about **MMCP architecture, types, or APIs**
- User wants to **add custom models, tools, or MCP servers** to MMCP

## Project Structure

```
mmcp/python/
├── mmcp_core/                    # Core SDK
│   ├── config.py                 # Central config (nothing hardcoded)
│   ├── complexity_analyzer.py    # Task complexity classifier
│   ├── smart_router.py           # RL-based model router
│   ├── tool_selector.py          # Auto tool discovery
│   ├── cost_optimizer.py         # Expense tracking + savings
│   ├── planner.py                # Task → execution plan
│   ├── executor.py               # Plan execution engine
│   ├── adapter.py                # Model API adapter (OpenRouter)
│   ├── types.py                  # All types and enums
│   ├── tools.py                  # Built-in tool implementations
│   ├── mcp_client.py             # MCP client for external servers
│   ├── skill_engine.py           # Reusable pipeline skills
│   ├── orchestrator.py           # DAG-based pipeline orchestrator
│   └── cli/                      # CLI commands
│       ├── __init__.py            # Parser + main()
│       ├── auto.py                # `mmcp auto` — autonomous mode
│       ├── run.py                 # `mmcp run` — interactive mode
│       ├── cost.py                # `mmcp cost` — spend management
│       ├── pipelines.py           # chain/parallel/verify/shard
│       ├── audit.py               # Audit trail viewer
│       └── cloud.py               # Login/setup/account
├── mmcp_mcp_server/              # MCP Server for Claude/Codex
│   ├── server.py                  # FastMCP server (10 tools)
│   ├── __main__.py                # python -m entry point
│   └── configs/
│       ├── claude_desktop_config.json
│       └── codex_config.toml
└── pyproject.toml                # Package config (pip install mmcp-core)
```

## Quick Reference

### Installation

```bash
# From PyPI
pip install mmcp-core[mcp-server]

# From source (dev mode)
cd mmcp/python && pip install -e ".[mcp-server]"
```

### CLI Commands

```bash
mmcp auto "task"              # Autonomous: plan + route + execute
mmcp run                      # Interactive mode
mmcp cost                     # Spend summary
mmcp cost savings             # Savings recommendations
mmcp cost budget 1.0          # Set $1/day budget cap
mmcp cost report              # Model value report
mmcp cost mcp                 # MCP overhead report
mmcp chain "task" -r a,b,c    # Sequential pipeline
mmcp skills                   # List saved skills
mmcp setup                    # API key wizard
```

### MCP Server (for Claude Desktop / Codex)

```bash
# Start server
python -m mmcp_mcp_server
# or
mmcp-mcp-server
```

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "mmcp-core": {
      "command": "python",
      "args": ["-m", "mmcp_mcp_server"],
      "env": {"OPENROUTER_API_KEY": "sk-or-..."}
    }
  }
}
```

**Codex CLI**:
```bash
codex mcp add mmcp-core -- python -m mmcp_mcp_server
```

## References

For detailed documentation on specific topics, read these files:

- **Architecture & Config**: [references/architecture.md](references/architecture.md)
- **MCP Server Tools**: [references/mcp-server.md](references/mcp-server.md)
- **Smart Routing**: [references/smart-routing.md](references/smart-routing.md)
- **Cost Optimization**: [references/cost-optimization.md](references/cost-optimization.md)
- **Developer Guide (adding models/tools)**: [references/developer-guide.md](references/developer-guide.md)
