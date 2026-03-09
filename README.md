<div align="center">

# 🔀 MMCP — Multiple Model Context Protocol

**Orchestrate AI models as a coordinated DAG. One CLI. Every model. Smart routing.**

[![PyPI](https://img.shields.io/pypi/v/mmcp-core?style=flat-square&logo=pypi&label=PyPI)](https://pypi.org/project/mmcp-core/)
[![npm](https://img.shields.io/npm/v/@mmcp/core?style=flat-square&logo=npm)](https://npmjs.com/package/@mmcp/core)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Railway](https://img.shields.io/badge/API-live-brightgreen?style=flat-square&logo=railway)](https://mmcp.up.railway.app/health)
[![GitHub stars](https://img.shields.io/github/stars/RagavRida/mmcp?style=flat-square&logo=github)](https://github.com/RagavRida/mmcp/stargazers)

</div>

---

<div align="center">

**MCP standardizes tool use for a single model.**
**MMCP standardizes context flow *between* models.**

</div>

---

## ⚡ 30-Second Quick Start

```bash
pip install git+https://github.com/RagavRida/mmcp.git#subdirectory=python
mmcp login
mmcp run
```

That's it. Type a task, MMCP picks the best model + pattern automatically.

## 🧠 Smart Routing — The Right Model for Every Task

MMCP analyzes your task and auto-selects the optimal model from 8+ providers:

| Your Task | Model Selected | Why |
|-----------|---------------|-----|
| "Write a Python API with auth" | **Gemini 2.5 Pro** | Top-tier for coding |
| "Debug this React component" | **GPT-4o** | Strong at code generation |
| "Prove this calculus theorem" | **DeepSeek R1** | Best for math & reasoning |
| "Write a blog post about AI" | **Claude Sonnet** | Excellent creative writing |
| "Analyze market strategy" | **Claude Sonnet** | Deep reasoning & analysis |
| "Summarize this in one line" | **Llama 4 Maverick** | Fast & free |

> You don't pick the model. You describe the task. MMCP figures out the rest.

## 🏗️ How It Works

```
User: "Build a REST API for a todo app"

MMCP Smart Router:
  ├── Task type:   Coding (2 keywords matched)
  ├── Complexity:  High
  ├── Pattern:     Deep dive (shard → merge)
  └── Model:       Gemini 2.5 Pro

DAG Execution:
  [root] orchestrator (gemini-2.5-pro)
    ├── [shard] analyst-1 ──┐
    ├── [shard] analyst-2 ──┤
    └── [shard] analyst-3 ──┤
                            ▼
                   [merge] editor
                       │
                   Final Output
```

Every node produces a **Context Envelope** — an inspectable, serializable record. The full DAG is your audit trail.

## 🔄 The 5 Protocol Operations

| Operation | Flow | Use Case |
|-----------|------|----------|
| **Chain** | A → B → C | Sequential review pipeline |
| **Fork/Merge** | A → [B,C,D] → E | Parallel analysis, brainstorming |
| **Verify** | Producer → Challenger → Judge | Adversarial fact-checking |
| **Shard** | A → [A₁,A₂,A₃] → Merge | Long document processing |
| **Handoff** | A → B | Transfer between specialists |

## 💰 MMCP Cloud — Use Without API Keys

Don't have API keys? Use **MMCP Cloud** — we handle the infrastructure:

```bash
mmcp login      # create free account
mmcp run        # just type your task
mmcp account    # check usage
```

| Plan | Price | Runs/mo | Best For |
|------|-------|---------|----------|
| **Free** | $0 | 50 | Try it out |
| **Pro** | $19/mo | 500 | Daily use |
| **Team** | $49/mo | Unlimited | Teams |

> **BYOK mode**: Already have API keys? Use `mmcp setup` instead — it's free forever.

## 📦 Installation

### Python (CLI + SDK)

```bash
# From GitHub
pip install git+https://github.com/RagavRida/mmcp.git#subdirectory=python

# BYOK mode (bring your own key)
mmcp setup

# OR Cloud mode (no keys needed)
mmcp login
```

### TypeScript/Node.js

```bash
npm install @mmcp/core
```

## 🛠️ CLI Commands

```bash
mmcp run                                    # Interactive smart mode
mmcp chain   "task" -r writer,reviewer      # Sequential pipeline
mmcp parallel "task" -f coder,analyst -m summarizer  # Parallel
mmcp verify  "task" -p expert -c critic -s judge     # Adversarial
mmcp shard   "task" -r analyst -n 3 -M editor        # Deep dive
mmcp audit   output.json                    # View audit trail
mmcp account                                # Usage & billing
mmcp version                                # Version info
```

## 🔧 Python SDK

```python
from mmcp_core import MMCPOrchestrator, RoleBasedRouter

orc = MMCPOrchestrator(config={
    "router": RoleBasedRouter(),
    "adapter": call_openrouter,  # or call_anthropic
})

# Chain: writer → reviewer → editor
result = await orc.run_chain(
    "Write a blog post about quantum computing",
    ["writer", "reviewer", "editor"]
)

print(result.output)       # final text
print(result.total_tokens) # cost tracking
print(result.dag)          # full audit trail
```

## 📊 TypeScript SDK

```typescript
import { MMCPOrchestrator, RoleBasedRouter } from "@mmcp/core";

const orc = new MMCPOrchestrator({
  router: new RoleBasedRouter({
    architect: { model_id: "claude-opus-4-20250514" },
    coder:     { model_id: "claude-sonnet-4-20250514" },
    verifier:  { model_id: "claude-sonnet-4-20250514" },
  }),
});

const result = await orc.runChain(
  "Build a REST API for a todo app",
  ["architect", "coder", "verifier"]
);
```

## 🆚 Why MMCP?

| Feature | MMCP | LangChain | CrewAI | AutoGen |
|---------|------|-----------|--------|---------|
| Multi-model DAG | ✅ | ❌ | ❌ | ⚠️ |
| Smart model routing | ✅ | ❌ | ❌ | ❌ |
| 8+ providers | ✅ | ✅ | ⚠️ | ⚠️ |
| Audit trail | ✅ Built-in | ❌ | ❌ | ❌ |
| CLI (no code needed) | ✅ | ❌ | ❌ | ❌ |
| Cloud hosted | ✅ | ❌ | ❌ | ❌ |
| Protocol-level spec | ✅ | ❌ | ❌ | ❌ |
| Setup time | 30 sec | Hours | Hours | Hours |

## 🧪 Context Envelope (Protocol Primitive)

Every model invocation produces a Context Envelope:

```json
{
  "mmcp_version": "0.1",
  "id": "ctx_a1b2c3",
  "parent_ids": ["ctx_root"],
  "task": "Review the code for security issues",
  "role": "security_auditor",
  "model": "anthropic/claude-sonnet-4",
  "branch_type": "fork",
  "status": "done",
  "output": "Found 3 potential vulnerabilities...",
  "tokens_used": 1847,
  "cost_usd": 0.003
}
```

## 🛣️ Roadmap

- [x] Core DAG schema + 5 protocol operations
- [x] TypeScript SDK + Python SDK
- [x] CLI with smart routing (8+ models)
- [x] MMCP Cloud (hosted proxy with billing)
- [x] Multi-provider: Anthropic, OpenAI, Google, Meta, DeepSeek, Mistral
- [ ] Streaming outputs
- [ ] Web dashboard + playground
- [ ] PyPI package (`pip install mmcp`)
- [ ] Confidence scoring + auto-retry
- [ ] MMCP Registry (share pipeline configs)
- [ ] Enterprise: SSO, audit export, compliance

## 🤝 Contributing

```bash
git clone https://github.com/RagavRida/mmcp.git
cd mmcp/python
pip install -e ".[all]"
pytest
```

## 📄 License

MIT — use it for anything.

---

<div align="center">

**⭐ Star this repo if MMCP saves you from model selection headaches**

[Report Bug](https://github.com/RagavRida/mmcp/issues) · [Request Feature](https://github.com/RagavRida/mmcp/issues) · [MMCP Cloud](https://mmcp.up.railway.app/health)

</div>
