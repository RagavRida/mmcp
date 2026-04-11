<div align="center">

# 🔀 MMCP — Multi-Model Collaboration Pipeline

**Orchestrate AI models as a coordinated DAG. RL routing · Multi-verifier voting · Agent mesh · Self-improving.**

[![npm](https://img.shields.io/npm/v/mmcp-core?style=flat-square&logo=npm&color=red)](https://npmjs.com/package/mmcp-core)
[![PyPI](https://img.shields.io/pypi/v/mmcp-core?style=flat-square&logo=pypi&label=PyPI&color=blue)](https://pypi.org/project/mmcp-core/)
[![Downloads](https://img.shields.io/pypi/dm/mmcp-core?style=flat-square&label=downloads)](https://pypi.org/project/mmcp-core/)
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
pip install mmcp-core
mmcp login
mmcp run
```

That's it. Type a task, MMCP picks the best model + pattern automatically.

## 🧠 Domain-Aware RL Routing — The Right Model for Every Task

MMCP doesn't just pick a model — it **learns per domain** which model performs best, then routes automatically. When models get updated, benchmark results feed back into the router.

| Your Task | Domain Detected | Model Selected | Domain Score |
|-----------|----------------|---------------|-------------|
| "Write a Python API with auth" | `code_generation` | **GPT-4o** | 0.96 |
| "Debug this React component" | `code_review` | **Claude Sonnet** | 0.91 |
| "Prove this calculus theorem" | `math_reasoning` | **DeepSeek R1** | 0.92 |
| "Write a blog post about AI" | `creative_writing` | **Claude Sonnet** | 0.90 |
| "Find SQL injection in this code" | `security` | **Claude Opus** | 0.94 |
| "Summarize this in one line" | `summarization` | **Haiku** | 0.88 |

> GPT-4o scores 96% on code but 44% on math. DeepSeek scores 92% on math but 60% on code. **MMCP knows the difference and routes accordingly.**

### How Domain Routing Works

```typescript
import { DomainScoredRouter } from "mmcp-core";

const router = new DomainScoredRouter(
  ["claude-sonnet-4-20250514", "gpt-4o", "deepseek-r1"],
  { accuracy: 0.5, latency: 0.3, cost: 0.2 },
);

// Load benchmark scores per domain
router.loadBenchmarkResults([
  { model: "gpt-4o",      domain: "code_generation", success_rate: 0.96, avg_latency_ms: 800,  avg_cost_usd: 0.003, sample_size: 200 },
  { model: "gpt-4o",      domain: "math_reasoning",  success_rate: 0.44, avg_latency_ms: 3000, avg_cost_usd: 0.005, sample_size: 200 },
  { model: "deepseek-r1", domain: "math_reasoning",  success_rate: 0.92, avg_latency_ms: 1500, avg_cost_usd: 0.001, sample_size: 200 },
]);

// Router auto-detects domain from task and picks the best model
router.route({ task: "Write a parser", role: "coder" });
// → gpt-4o (code_generation domain: 0.96)

router.route({ task: "Prove the Riemann hypothesis", role: "reasoner" });
// → deepseek-r1 (math_reasoning domain: 0.92)
```

### Auto-Update When Models Change

```typescript
import { BenchmarkRouterBridge, MMCPBenchmarkSuite } from "mmcp-core";

const bridge = new BenchmarkRouterBridge(router, new MMCPBenchmarkSuite(), skillRegistry);

// When GPT-5 drops — benchmark it and update routing automatically
await bridge.onModelUpdated("gpt-5", async (task, model) => {
  const result = await callLLM(task, model);
  return { output: result.text, tokens_used: result.tokens, cost_usd: result.cost, latency_ms: result.latency };
});
// Router now has domain-specific scores for GPT-5
// Skill registry updated: GPT-5 gains "reasoning" skill if math score > 70%
```

### Per-Model Domain Profile

```typescript
router.getModelProfile("gpt-4o");
// [
//   { domain: "code_generation",  score: 0.48, runs: 200 },  // strong
//   { domain: "math_reasoning",   score: 0.02, runs: 200 },  // weak
//   { domain: "creative_writing", score: 0.15, runs: 100 },  // medium
//   ...
// ]
```

> You don't pick the model. You describe the task. MMCP learns which model wins at which domain.

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

### TypeScript/Node.js (v2.1 — full platform)

```bash
npm install mmcp-core
```

Includes: RL router, multi-verifier, network mesh, feedback loop, persistence, auth, HTTP agent protocol, and benchmark suite.

### Python (CLI + SDK)

```bash
pip install mmcp-core

# BYOK mode (bring your own key)
mmcp setup

# OR Cloud mode (no keys needed)
mmcp login
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
import {
  MMCPOrchestrator, ScoredRouter, MultiVerifier,
  IntentAwareVerifier, BuiltinConstraints,
  MMCPNetworkMesh, FeedbackLoop, IdentityManager,
} from "mmcp-core";

// RL-ready router with UCB1 exploration
const router = new ScoredRouter(
  ["claude-sonnet-4-20250514", "gemini-2.5-pro", "deepseek-r1"],
  { accuracy: 0.5, latency: 0.2, cost: 0.3 },
);

// Multi-verifier voting (majority consensus)
const mv = new MultiVerifier("majority");
const v1 = new IntentAwareVerifier();
v1.addConstraint(BuiltinConstraints.minLength(50));
v1.addConstraint(BuiltinConstraints.noHardcodedSecrets());
mv.addVerifier("critic_1", v1);
mv.addVerifier("critic_2", new IntentAwareVerifier());

// Agent network mesh
const mesh = new MMCPNetworkMesh("local", "capability_match");
mesh.registerNode({
  name: "India Agent", region: "ap-south",
  endpoint: "https://india.mmcp.io",
  capabilities: ["code_generation", "analysis"],
  status: "online", latency_ms: 50, load: 0.3, metadata: {},
});

// Orchestrate
const orc = new MMCPOrchestrator({ router });
const result = await orc.runChain(
  "Build a REST API for a todo app",
  ["architect", "coder", "verifier"]
);
```

## 🤝 Agent Coordination — Make Any Agent Collaborative

> 50% of deployed AI agents operate in total isolation. They can't share context, coordinate, or hand off tasks. MMCP fixes this with 3 primitives.

### Install

```bash
npm install mmcp-core
```

### 1. Register Agents (any framework — LangChain, CrewAI, AutoGen, custom)

```typescript
import { AgentCoordinator } from "mmcp-core";

const coord = new AgentCoordinator();

// Register your agents — just give them capabilities and a handler
const supportAgent = coord.register({
  name: "Support Agent",
  capabilities: ["customer_support", "refunds", "billing"],
  handler: async (handoff) => {
    // handoff.messages = full conversation history
    // handoff.context = shared memory snapshot
    const reply = await myLLM.chat(handoff.messages);
    return { accepted: true, agent_id: handoff.to_agent, response: reply };
  },
});

const billingAgent = coord.register({
  name: "Billing Expert",
  capabilities: ["billing", "invoices", "payments"],
  handler: async (handoff) => {
    const reply = await billingLLM.chat(handoff.messages);
    return { accepted: true, agent_id: handoff.to_agent, response: reply };
  },
});

const codeAgent = coord.register({
  name: "Code Assistant",
  capabilities: ["code_generation", "debugging", "code_review"],
  handler: async (handoff) => {
    const reply = await codeLLM.chat(handoff.messages);
    return { accepted: true, agent_id: handoff.to_agent, response: reply };
  },
});
```

### 2. Shared Memory — Agents Read Each Other's Context

```typescript
// Agent A writes context
coord.write(supportAgent, "user_intent", "billing question");
coord.write(supportAgent, "user_tier", "enterprise");
coord.write(supportAgent, "sentiment", "frustrated");

// Agent B reads it — no API calls, no DB, just shared memory
const intent = coord.read(billingAgent, "user_intent");
// → "billing question"

const tier = coord.read(billingAgent, "user_tier");
// → "enterprise"

// TTL support — auto-expires sensitive data
coord.write(supportAgent, "auth_token", "abc123", 60000); // expires in 60s
```

### 3. Handoff — Transfer Conversations Without Losing State

```typescript
// Support agent can't handle billing → hand off to billing expert
const result = await coord.handoff({
  from_agent: supportAgent,
  to_agent: billingAgent,
  conversation_id: "conv_123",
  messages: [
    { role: "user", content: "I need a refund for my last invoice" },
    { role: "assistant", content: "Let me transfer you to our billing team.", agent: "Support Agent" },
  ],
  context: { invoice_id: "INV-2024-001", amount: 299.99 },
  reason: "billing_request",
  priority: "urgent",
});

console.log(result.response); // "I can help with your refund for INV-2024-001..."
```

The billing agent receives the **full conversation**, **shared memory snapshot**, and **custom context** — zero information lost.

### 4. Auto-Discovery — Don't Know Which Agent? Let MMCP Find It

```typescript
// You don't need to know agent IDs. Describe what you need:
const result = await coord.autoHandoff(
  supportAgent,
  "conv_456",
  [{ role: "user", content: "My code has a bug" }],
  ["debugging", "code_review"],  // required capabilities
  "technical_issue",
);

// MMCP discovers the Code Assistant (best match for debugging + code_review)
// and hands off automatically
console.log(result.response); // Code Assistant's reply
```

### 5. Real-Time Events — Monitor All Coordination

```typescript
coord.on((event) => {
  switch (event.type) {
    case "agent:joined":
      console.log(`${event.data.name} joined with capabilities: ${event.data.capabilities}`);
      break;
    case "handoff:start":
      console.log(`Handoff: ${event.agent_id} → ${event.data.to}`);
      break;
    case "handoff:complete":
      console.log(`Handoff accepted: ${event.data.accepted}`);
      break;
    case "memory:write":
      console.log(`Shared memory: ${event.data.key} (v${event.data.version})`);
      break;
  }
});
```

### Full Example: Customer Support System

```typescript
import { AgentCoordinator } from "mmcp-core";

const coord = new AgentCoordinator();

// Register specialized agents
coord.register({ name: "Intake",   capabilities: ["intake", "classify"], handler: intakeHandler });
coord.register({ name: "Billing",  capabilities: ["billing", "refunds"], handler: billingHandler });
coord.register({ name: "Tech",     capabilities: ["debugging", "code"],  handler: techHandler });
coord.register({ name: "Escalation", capabilities: ["escalation", "manager"], handler: escalationHandler });

// User message comes in
const messages = [{ role: "user", content: "My API key isn't working and I'm being charged" }];

// Intake agent classifies and writes to shared memory
coord.write(intakeAgent, "issue_type", "billing+technical");
coord.write(intakeAgent, "urgency", "high");

// Auto-discover: needs both billing AND technical
const techResult = await coord.autoHandoff(intakeAgent, "conv_1", messages, ["debugging"], "api_issue");
// Code agent handles the technical part

// Then billing
const billResult = await coord.autoHandoff(intakeAgent, "conv_1", messages, ["billing"], "charge_dispute");
// Billing agent handles the charge — sees shared memory from both prior agents

// If neither resolves it
const escalation = await coord.autoHandoff(intakeAgent, "conv_1", messages, ["escalation"], "unresolved");
// Manager agent gets full context from ALL prior agents via shared memory
```

### Use with LangChain

```typescript
import { AgentCoordinator } from "mmcp-core";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

const coord = new AgentCoordinator();
const llm = new ChatOpenAI({ model: "gpt-4" });

coord.register({
  name: "LangChain Agent",
  capabilities: ["qa", "summarization"],
  handler: async (handoff) => {
    const response = await llm.invoke(handoff.messages.map(m => new HumanMessage(m.content)));
    return { accepted: true, agent_id: handoff.to_agent, response: response.content as string };
  },
});
```

### Use with CrewAI (Python → TypeScript bridge)

```typescript
// Your CrewAI agent runs as a service
coord.register({
  name: "CrewAI Research Agent",
  capabilities: ["research", "web_search"],
  handler: async (handoff) => {
    const res = await fetch("http://localhost:8000/crewai/run", {
      method: "POST",
      body: JSON.stringify({ messages: handoff.messages, context: handoff.context }),
    });
    const data = await res.json();
    return { accepted: true, agent_id: handoff.to_agent, response: data.result };
  },
});
```

---

## 🆚 Why MMCP?

| Feature | MMCP | LangChain | CrewAI | AutoGen |
|---------|------|-----------|--------|---------|
| Multi-model DAG | ✅ | ❌ | ❌ | ⚠️ |
| **Domain-aware RL routing** | ✅ | ❌ | ❌ | ❌ |
| **Auto-update on model release** | ✅ | ❌ | ❌ | ❌ |
| Per-domain benchmarking | ✅ | ❌ | ❌ | ❌ |
| 8+ providers | ✅ | ✅ | ⚠️ | ⚠️ |
| Audit trail | ✅ Built-in | ❌ | ❌ | ❌ |
| CLI (no code needed) | ✅ | ❌ | ❌ | ❌ |
| Cloud hosted | ✅ | ❌ | ❌ | ❌ |
| Protocol-level spec | ✅ | ❌ | ❌ | ❌ |
| Setup time | 30 sec | Hours | Hours | Hours |

## 📡 MMCP Protocol Message (v2.1)

Every inter-agent message conforms to the [MMCP Protocol Spec](PROTOCOL_SPEC.md):

```json
{
  "mmcp_version": "2.0",
  "schema_version": "2.0",
  "message_id": "msg_a1b2c3",
  "trace_id": "trace_xyz789",
  "parent_message_id": "msg_root",
  "idempotency_key": "idem_abc",
  "sender": "architect",
  "receiver": "coder",
  "task_id": "task_001",
  "intent": "code_generation",
  "payload": { "task": "Build REST API" },
  "context_id": "ctx_a1b2c3",
  "confidence": 0.95,
  "status": "success",
  "timestamp": "2026-03-19T00:00:00Z"
}
```

### v2.1 Platform Features

| Module | What It Does |
|--------|-------------|
| 🧠 **Domain RL Router** | Learns per-domain scores (code, math, writing, security) — routes to the best model FOR THAT domain |
| 🔄 **Benchmark Bridge** | When models update, auto-benchmarks and feeds results into the router + skill registry |
| ✅ **Multi-Verifier** | N critics vote via majority/unanimous/weighted consensus |
| 🌐 **Network Mesh** | Multi-node agents across regions with 4 routing strategies |
| 🔁 **Feedback Loop** | exec → verify → memory → router update (self-improving) |
| 💾 **Persistence** | Checkpoint/restore for crash recovery |
| 🔌 **HTTP Agent** | `POST /mmcp/execute` — turn any agent into an API |
| 🔑 **Auth Layer** | API keys, 8 permission types, revocation |
| 📏 **Benchmark** | Compare MMCP vs single-model on cost/latency/accuracy |

## 🛣️ Roadmap

- [x] Core DAG schema + 5 protocol operations
- [x] TypeScript SDK + Python CLI
- [x] CLI with smart routing (8+ models)
- [x] MMCP Cloud (hosted proxy with billing)
- [x] Multi-provider: Anthropic, OpenAI, Google, Meta, DeepSeek, Mistral
- [x] npm package (`npm install mmcp-core`) ✅
- [x] PyPI package (`pip install mmcp-core`) ✅
- [x] RL-ready router (UCB1 + ε-greedy)
- [x] Multi-verifier voting (majority/unanimous/weighted)
- [x] MMCP Network Mesh (multi-node agents)
- [x] Self-improving feedback loop
- [x] Execution persistence + checkpoint/restore
- [x] HTTP Agent Protocol + SDK
- [x] Identity & Auth layer
- [x] Benchmark suite
- [x] Protocol Spec (RFC-style)
- [x] Domain-aware RL routing (per-domain model scoring)
- [x] Benchmark → Router bridge (auto-update on model release)
- [x] Skill registry auto-refresh from benchmarks
- [ ] Real-time streaming dashboard
- [ ] Partial DAG replay
- [ ] Enterprise: SSO, audit export, compliance

## 🤝 Contributing

```bash
git clone https://github.com/RagavRida/mmcp.git
cd mmcp/python
pip install -e ".[all]"
pytest
```

Or install from PyPI to use:
```bash
pip install mmcp-core
```

## 📄 License

MIT — use it for anything.

---

<div align="center">

**⭐ Star this repo if MMCP saves you from model selection headaches**

[Report Bug](https://github.com/RagavRida/mmcp/issues) · [Request Feature](https://github.com/RagavRida/mmcp/issues) · [MMCP Cloud](https://mmcp.up.railway.app/health)

</div>
