# MMCP Developer Guide

How to extend MMCP with custom models, tools, MCP servers, complexity signals, and domains.

## Adding a Custom Model

### Via Config File

```yaml
# ~/.mmcp/config.yaml
models:
  pricing:
    my-org/custom-llm-v3:
      input: 0.5    # USD per 1M input tokens
      output: 1.0   # USD per 1M output tokens

  tiers:
    standard:
      - my-org/custom-llm-v3    # Add to standard tier
      - anthropic/claude-3.5-haiku

  domain_preferences:
    code_generation:
      complex: my-org/custom-llm-v3  # Prefer for code tasks
```

### Via Python

```python
from mmcp_core import MMCPConfig, set_config

config = MMCPConfig(models={
    "pricing": {"my-org/custom-llm-v3": {"input": 0.5, "output": 1.0}},
    "tiers": {"standard": ["my-org/custom-llm-v3", "anthropic/claude-3.5-haiku"]},
})
set_config(config)
```

### Via Environment Variable

```bash
export MMCP_DEFAULT_MODEL="my-org/custom-llm-v3"
```

## Adding a Custom Built-in Tool

### Via Config File

```yaml
# ~/.mmcp/config.yaml
tools:
  builtin:
    my_rag_tool:
      description: "Search internal knowledge base"
      tags: [rag, search, knowledge, internal, vector]
      cost_per_call: 0.0
      avg_latency_ms: 200
      parameters:
        query: "Search query string"
        top_k: "Number of results (default 5)"
```

### Via Python

```python
from mmcp_core.tool_selector import ToolCapability, ToolTier, reload_registry
from mmcp_core import MMCPConfig, set_config

config = MMCPConfig(tools={"builtin": {
    "my_rag_tool": {
        "description": "Search internal knowledge base",
        "tags": ["rag", "search", "knowledge"],
        "cost_per_call": 0.0,
        "avg_latency_ms": 200,
    }
}})
set_config(config)
reload_registry(config)  # Refresh tool cache
```

### Implementing the Tool Execution

Add to `mmcp_core/tools.py`:

```python
# In TOOL_REGISTRY, add:
"my_rag_tool": {
    "description": "Search internal knowledge base",
    "handler": "my_rag_handler",
    "parameters": {"query": {"type": "string"}, "top_k": {"type": "integer"}},
},

# Add handler function:
async def my_rag_handler(query: str, top_k: int = 5) -> str:
    # Your implementation here
    pass
```

## Adding an MCP Server

### Via Config File

```yaml
# ~/.mmcp/config.yaml
tools:
  mcp_servers:
    my_database:
      command: node
      args: [/opt/mcp-servers/db-server.js]
      description: "Internal database operations"
    
    my_api:
      command: python
      args: [-m, my_mcp_api_server]
      description: "Internal API access"
      env:
        API_KEY: "secret-key"
```

### Via Python (MCPConnectionPool)

```python
from mmcp_core import MCPConnectionPool, MMCPConfig

config = MMCPConfig(tools={"mcp_servers": {
    "my_db": {"command": "node", "args": ["/opt/mcp-servers/db.js"]},
}})

pool = MCPConnectionPool(config=config)
client = await pool.get_or_connect("my_db")
result, metrics = await pool.call_tool("my_db", "query", {"sql": "SELECT 1"})
```

## Adding MCP → Built-in Equivalence

When your MCP server duplicates a built-in tool's functionality:

```yaml
# ~/.mmcp/config.yaml
tools:
  mcp_equivalents:
    my_mcp_read: read_file      # MCP tool → built-in equivalent
    my_mcp_search: web_search
```

This ensures MMCP always prefers the free built-in over the MCP call.

## Adding Custom Complexity Signals

### Via Config File

```yaml
# ~/.mmcp/config.yaml
complexity:
  signals:
    frontier:
      - "formal verification"
      - "zero-day exploit"
      - "novel algorithm"
    complex:
      - "microservices"
      - "distributed cache"
    
  domain_keywords:
    bioinformatics:
      - genome
      - protein
      - DNA
      - CRISPR
      - sequencing
    
  domain_floor:
    bioinformatics: complex   # Bio tasks are always >= COMPLEX
```

## Adding an MCP Server Tool to the MCP Server

Edit `mmcp_mcp_server/server.py`:

```python
@mcp.tool()
def my_custom_tool(param1: str, param2: int = 10) -> str:
    """Description shown to Claude/Codex.

    Args:
        param1: What this parameter does
        param2: Another parameter (default: 10)
    """
    from mmcp_core import some_function
    result = some_function(param1, param2)
    return json.dumps(result, indent=2)
```

Restart the MCP server after editing. Claude Desktop needs a full restart.

## Testing Changes

```python
# Test config override
from mmcp_core import MMCPConfig, SmartRouter, analyze_complexity

config = MMCPConfig(models={"pricing": {"test/model": {"input": 1, "output": 2}}})
router = SmartRouter(config=config)
result = router.route("test task")
print(f"Routed to: {result.model}")

# Test tool selector
from mmcp_core import select_tools
matches = select_tools("search knowledge base", config=config)
print(f"Found: {[m.tool_name for m in matches]}")

# Test MCP server tools
from mmcp_mcp_server.server import analyze_task
import json
print(json.loads(analyze_task("test task")))
```

## Key Design Principles

1. **Nothing hardcoded**: All tables, signals, pricing come from `MMCPConfig`
2. **Built-in first**: Always prefer free built-in tools over MCP
3. **Token-optimized**: Compact prompts, bounded context injection
4. **RL-adaptive**: Model selection improves with usage via UCB1 feedback
5. **Cost-tracked**: Every call logged to expense ledger for analysis
6. **Config-as-code**: YAML/JSON config, env vars, or programmatic API
