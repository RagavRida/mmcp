# MMCP Cost Optimization Reference

## Expense Tracking

All expenses are stored in `~/.mmcp/expenses/YYYY-MM-DD.jsonl` (configurable via `storage.expenses_dir`).

Each entry tracks:
```python
@dataclass
class ExpenseEntry:
    timestamp: str
    task_summary: str
    entry_type: str          # "model_call", "mcp_tool", "builtin_tool"
    model: str = ""
    domain: str = "general"
    complexity: str = "standard"
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    success: bool = True
    was_justified: bool = True
    mcp_server: str = ""
    tool_name: str = ""
    overhead_ms: int = 0
    builtin_available: bool = False
```

## Savings Recommendation Categories

| Category | Detects | Example |
|---|---|---|
| `model_waste` | Frontier models on trivial tasks | "opus wasted on trivial tasks, save $3.80" |
| `downgrade` | Premium models on standard tasks | "Downgrade sonnet for standard tasks, save $1.20" |
| `mcp_to_builtin` | MCP tools with free built-in equivalents | "Switch filesystem:read_file to built-in, save 12s" |
| `mcp_reuse` | Repeated MCP server cold starts | "Pool github connections, eliminate 5 startups" |

### How Detection Works

- **Premium models**: Identified from config pricing (`output >= $5/1M tokens`)
- **Frontier models**: Identified from config pricing (`output >= $10/1M tokens`)
- **MCP equivalents**: Checked against `config.mcp_to_builtin` map
- **No hardcoded model names** — all detection is dynamic from config

## Budget System

```python
from mmcp_core import CostOptimizer

optimizer = CostOptimizer()

# Set budget
optimizer.set_budget(5.0)  # $5/day

# Check status
status = optimizer.get_budget_status()
# → BudgetStatus(daily_budget_usd=5.0, spent_today_usd=1.23, remaining_usd=3.77, ...)

# When budget < 10% remaining → downgrade_active = True
# When budget exhausted → is_over_budget = True, SmartRouter forces TRIVIAL tier
```

## CLI Commands

```bash
# Spend summary (last 30 days)
mmcp cost

# Savings recommendations
mmcp cost savings

# Set daily budget
mmcp cost budget 5.0

# Model value report (which models justify their cost)
mmcp cost report

# MCP overhead report (startup costs per server)
mmcp cost mcp
```

## Python API

```python
from mmcp_core import CostOptimizer, TaskComplexity

optimizer = CostOptimizer()

# Record a model call
optimizer.record_model_call(
    task="summarize paper",
    model="anthropic/claude-opus-4",
    domain="summarization",
    complexity=TaskComplexity.TRIVIAL,
    input_tokens=500,
    output_tokens=200,
    cost_usd=0.02,
    latency_ms=3000,
    success=True,
    was_justified=False,  # opus for trivial = unjustified
)

# Analyze spending
analysis = optimizer.analyze_spend(period_days=30)
print(optimizer.format_spend_summary(analysis))

# Get recommendations
recs = optimizer.get_savings_recommendations()
for r in recs:
    print(f"[{r.category}] {r.title}: save ${r.estimated_savings_usd:.4f}")

# Model value report
report = optimizer.get_model_value_report()
# { "model": { "value_score": 0.85, "success_rate": 0.95, ... } }

# MCP overhead report
mcp_report = optimizer.get_mcp_overhead_report()
# { "total_mcp_calls": 20, "total_overhead_ms": 60000, ... }
```

## Token Optimization

MMCP optimizes token usage to reduce costs:

| Feature | Setting | Default | Effect |
|---|---|---|---|
| Compact prompts | `tokens.compact_system_prompts` | `true` | 44% fewer planner prompt tokens |
| Context truncation | `tokens.max_context_injection_tokens` | `2000` | Bounds dep output injection |
| Per-dep budgeting | automatic | — | 3 deps = 666 tokens each |
| Truncation strategy | `tokens.truncation_strategy` | `tail` | head / tail / middle |
| Token estimation | `tokens.estimate_ratio` | `4` | chars ÷ ratio = est. tokens |

```python
from mmcp_core import MMCPConfig

config = MMCPConfig(tokens={
    "max_context_injection_tokens": 1000,
    "compact_system_prompts": True,
    "truncation_strategy": "middle",
})

# Estimate tokens
est = config.estimate_tokens("Hello world " * 100)  # ~300

# Truncate
truncated = config.truncate_to_tokens(long_text, max_tokens=500)
```
