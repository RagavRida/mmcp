# MMCP MCP Server Reference

## Overview

The MCP server (`mmcp_mcp_server/server.py`) exposes MMCP's capabilities as MCP tools for Claude Desktop and Codex CLI. It uses `FastMCP` from the `mcp` Python SDK over `stdio` transport.

## 10 Tools

### analyze_task

Classify task complexity and recommend optimal model.

```
Input:  { "task": "prove the Riemann hypothesis" }
Output: {
  "complexity": "frontier",
  "domain": "math_reasoning",
  "recommended_model": { "model": "deepseek/deepseek-r1", "estimated_cost": "$0.001" },
  "cheaper_alternative": { "model": "llama-4-maverick", "savings_percent": "71%" }
}
```

### plan_task

Decompose a task into executable steps with per-step model justification.

```
Input:  { "task": "Research AI trends and write a blog post", "auto_select_models": true }
Output: {
  "total_steps": 4,
  "steps": [
    { "step": 1, "action": "tool", "tool_name": "web_search", "model": null },
    { "step": 2, "action": "research", "model": "deepseek/deepseek-r1", "depends_on": [1] },
    { "step": 3, "action": "write", "model": "claude-sonnet-4", "depends_on": [2] },
    { "step": 4, "action": "review", "model": "claude-3.5-haiku", "depends_on": [3] }
  ]
}
```

### execute_task

Full autonomous pipeline: plan → route → execute → result.

```
Input:  { "task": "Summarize the latest AI papers", "auto_approve": true }
Output: {
  "status": "done",
  "tokens_used": 5432,
  "cost_usd": "$0.003",
  "output": "..."
}
```

With `auto_approve: false` (default), returns the plan for review first.

### select_tools_for_task

Auto-discover tools ranked by relevance, preferring free built-ins.

```
Input:  { "task": "search the web and save to file", "max_tools": 5 }
Output: {
  "tools": [
    { "name": "web_search", "tier": "builtin", "relevance_score": 0.5 },
    { "name": "write_file", "tier": "builtin", "relevance_score": 0.3 }
  ]
}
```

### cost_summary

Spending analysis over a period.

```
Input:  { "period_days": 30 }
Output: {
  "total_cost_usd": "$12.47",
  "total_calls": 342,
  "by_model": { "deepseek-r1": "$5.23", "claude-sonnet-4": "$4.10" }
}
```

### cost_savings

Actionable recommendations to reduce spend.

```
Input:  {}
Output: {
  "recommendations": [
    { "category": "model_waste", "title": "opus wasted on trivial tasks", "estimated_savings_usd": "$3.80" },
    { "category": "mcp_to_builtin", "title": "Switch filesystem:read_file to built-in", "estimated_savings_time_ms": 12000 }
  ]
}
```

### set_budget

Set daily spend cap. Models auto-downgrade when approaching limit.

```
Input:  { "daily_usd": 1.0 }
Output: { "status": "budget_set", "daily_budget_usd": "$1.00" }
```

### model_value_report

Value analysis per model: success rate × justification rate.

```
Input:  {}
Output: {
  "models": {
    "claude-sonnet-4": { "total_calls": 150, "success_rate": "95%", "value_score": 0.85 },
    "claude-opus-4": { "total_calls": 10, "justified_pct": "30%", "value_score": 0.28 }
  }
}
```

### list_skills

List saved reusable pipeline skills.

### configure

View/update MMCP configuration. Actions: `view`, `models`, `tools`, `routing`, `tokens`.

```
Input:  { "action": "routing" }
Output: { "default_model": "claude-3.5-haiku", "epsilon": 0.10, ... }
```

## Setup

### Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json`

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

Restart Claude Desktop after editing.

### Codex CLI

```bash
# One-liner
codex mcp add mmcp-core -- python -m mmcp_mcp_server

# Or edit ~/.codex/config.toml:
[mcp_servers.mmcp-core]
command = "python"
args = ["-m", "mmcp_mcp_server"]
```

### Any MCP Client

```bash
# Via entry point
mmcp-mcp-server

# Via module
python -m mmcp_mcp_server
```

## Important Notes

- **stdout is reserved** for MCP JSON-RPC. All logging goes to stderr.
- The server uses **lazy imports** to minimize startup time.
- `OPENROUTER_API_KEY` must be set for `plan_task` and `execute_task` tools.
- All tools return **structured JSON** strings.
