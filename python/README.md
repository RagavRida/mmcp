# MMCP Python SDK

**Self-orchestrating multi-model AI pipeline** — auto-routes tasks to the best AI model with smart routing, streaming, and audit trails.

[![PyPI](https://img.shields.io/pypi/v/mmcp-core)](https://pypi.org/project/mmcp-core/)
[![Tests](https://github.com/RagavRida/mmcp/actions/workflows/ci.yml/badge.svg)](https://github.com/RagavRida/mmcp/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Install

```bash
pip install mmcp-core

# With LangChain/LangGraph support
pip install mmcp-core[langchain]

# With Cloud server (PostgreSQL + Stripe)
pip install mmcp-core[cloud]

# Everything
pip install mmcp-core[all]
```

## Quick Start — CLI

```bash
# Interactive mode with smart routing
mmcp run

# Autonomous pipeline — MMCP plans and executes
mmcp auto "Research Python best practices and write a summary"

# Direct pipeline commands
mmcp chain "Explain DAGs" -r architect,reviewer --openrouter
mmcp parallel "Analyze market trends" -f analyst,creative,critic -M synthesizer
mmcp verify "Evaluate React vs Vue" -p expert -c challenger -s synthesizer
mmcp shard "Write a report on AI" -r analyst -n 3 -M editor
```

## Quick Start — Python SDK

```python
import asyncio
from mmcp_core import MMCPOrchestrator, RoleBasedRouter, MemoryStore

async def main():
    orc = MMCPOrchestrator({
        "router": RoleBasedRouter({
            "architect": {"model_id": "claude-haiku-4-5-20251001"},
            "reviewer":  {"model_id": "claude-haiku-4-5-20251001"},
        }),
        "store": MemoryStore(),
    })

    result = await orc.run_chain(
        "Explain the observer pattern in Python.",
        ["architect", "reviewer"]
    )

    print(f"✅ {result.output}")
    print(f"🪙 Tokens: {result.total_tokens}")
    print(f"💰 Cost: ${result.total_cost_usd:.6f}")

asyncio.run(main())
```

## Streaming Execution (v1.1.0)

```python
from mmcp_core.stream_executor import stream_execute
from mmcp_core.planner import plan_task

plan = await plan_task("Research AI trends", api_key="sk-or-...")

async for event in stream_execute(plan):
    if event["type"] == "step_token":
        print(event["content"], end="", flush=True)
    elif event["type"] == "step_done":
        print(f"\n✓ Step {event['step']} ({event['tokens']} tokens)")
    elif event["type"] == "plan_done":
        print(f"\nTotal: {event['total_tokens']} tokens, ${event['total_cost']}")
```

## v1.1.0 — What's New

| Feature | Description |
|---------|-------------|
| 🧠 Autonomous Mode | `mmcp auto` — AI plans and executes multi-step tasks |
| 🔀 Smart Routing | Auto-selects model per task (Gemini, GPT-4o, Claude, DeepSeek, Llama) |
| 📡 Streaming | Real-time SSE output during pipeline execution |
| 🏗️ CLI Package | Modular `cli/` package (7 modules, was 1,299-line monolith) |
| 🐘 PostgreSQL | Production-ready DB layer (SQLite for dev, PostgreSQL for prod) |
| 💳 Stripe | Subscription billing for Pro/Team plans |
| ✅ Test Suite | 84 automated tests with GitHub Actions CI/CD |

## DAG Operations

| Operation | Signature | Description |
|-----------|-----------|-------------|
| `fork` | 1 → N | Spawn parallel sub-contexts |
| `merge` | N → 1 | Combine parent outputs |
| `handoff` | 1 → 1 | Pass to different model/role |
| `shard` | 1 → N | Split long content |
| `verify` | 1 → 2 | Trust contract (challenger + synthesizer) |

## LangGraph Tracer

```python
from langchain_mmcp import MMCPTracer

tracer = MMCPTracer(regulation_tags=["SOC2", "GDPR"], export_path="./mmcp-audits/")

# Add to ANY LangGraph or LangChain pipeline
result = app.invoke(input, config={"callbacks": [tracer]})
tracer.print_summary()
```

## Cloud Server

```bash
# Start locally
uvicorn mmcp_cloud.server:app --port 8765

# Or on Railway/Render with DATABASE_URL for PostgreSQL
DATABASE_URL=postgres://... uvicorn mmcp_cloud.server:app
```

**API Endpoints:**
- `POST /v1/auth/register` — Create account
- `POST /v1/auth/login` — Get API key
- `POST /v1/chat/completions` — Proxy with billing
- `POST /v1/chat/completions/stream` — SSE streaming
- `POST /v1/billing/checkout` — Stripe checkout
- `GET /v1/account/usage` — Usage stats

## Environment

```bash
# Required (at least one)
export OPENROUTER_API_KEY=sk-or-...   # Recommended (multi-model)
export ANTHROPIC_API_KEY=sk-ant-...   # Direct Anthropic

# Optional (cloud server)
export DATABASE_URL=postgres://...     # PostgreSQL
export STRIPE_SECRET_KEY=sk_...        # Stripe billing
```

## License

MIT
