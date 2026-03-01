# MMCP Python SDK

**Multiple Model Context Protocol** — orchestrate AI models as a coordinated DAG.

Python port of the **@mmcp/core** TypeScript SDK.

## Install

```bash
pip install mmcp-core

# With LangChain/LangGraph support
pip install mmcp-core[langchain]

# Development
pip install mmcp-core[dev]
```

## Quick Start

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

## DAG Operations

| Operation | Signature | Description |
|-----------|-----------|-------------|
| `fork` | 1 → N | Spawn parallel sub-contexts |
| `merge` | N → 1 | Combine parent outputs |
| `handoff` | 1 → 1 | Pass to different model/role |
| `shard` | 1 → N | Split long content |
| `verify` | 1 → 2 | Trust contract (challenger + synthesizer) |

## LangGraph Tracer — One Line

```python
from langchain_mmcp import MMCPTracer

tracer = MMCPTracer(
    regulation_tags=["SOC2", "GDPR"],
    export_path="./mmcp-audits/"
)

# Add to ANY LangGraph or LangChain pipeline
result = app.invoke(input, config={"callbacks": [tracer]})

# Access audit trail
wire_dag = tracer.get_wire_dag()
tracer.print_summary()
```

## Wire Format

Every execution produces a JSON WireDAG with:
- SHA-256 audit hashes per node
- Full parent DAG lineage
- Token usage and cost per node
- Regulation compliance tags
- Tamper-proof audit chain

## Environment

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## License

MIT
