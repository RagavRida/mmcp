# @mmcp/core

**Multiple Model Context Protocol** — orchestrate AI models as a coordinated DAG.

[![npm version](https://badge.fury.io/js/%40mmcp%2Fcore.svg)](https://badge.fury.io/js/%40mmcp%2Fcore)

## What is MMCP?

MMCP is an open protocol for coordinating multiple AI models as a system. Where MCP standardizes *tool use* for a single model, MMCP standardizes *context flow between models* — defining how tasks are forked, merged, sharded, handed off, and verified across a Directed Acyclic Graph (DAG) of model invocations.

```
User Task
    │
  [root] architect
    ├── [fork] coder ──────┐
    ├── [fork] reasoner ───┤
    └── [fork] researcher ─┤
                           ▼
                     [merge] verifier
                           │
                     [handoff] summarizer
                           │
                       Final Output
```

Every node is a **Context Envelope** — an inspectable, serializable record of what model processed what information. The full DAG is your audit trail.

## Installation

```bash
npm install @mmcp/core
```

## Quick Start

```typescript
import { MMCPOrchestrator, RoleBasedRouter } from "@mmcp/core";

const orc = new MMCPOrchestrator({
  router: new RoleBasedRouter({
    architect:   { model_id: "claude-opus-4-20250514" },
    coder:       { model_id: "claude-sonnet-4-20250514" },
    verifier:    { model_id: "claude-sonnet-4-20250514" },
    summarizer:  { model_id: "claude-haiku-4-5-20251001" },
  }),
  // adapter: "mock"  ← use this for testing without an API key
});

// Chain: architect → coder → verifier
const result = await orc.runChain(
  "Build a REST API for a todo app with JWT auth",
  ["architect", "coder", "verifier"]
);

console.log(result.output);
console.log(result.dag);          // full audit trail
console.log(result.total_tokens); // cost tracking
```

## The 5 Protocol Operations

### `fork()` — 1 → N
Spawn parallel sub-contexts from a single parent.
```typescript
const [frontend, backend, security] = fork(root, [
  { role: "frontend" },
  { role: "backend" },
  { role: "security" },
]);
```

### `merge()` — N → 1
Combine multiple parent outputs. This is why MMCP uses a DAG (not a tree) — `parent_ids` is an array.
```typescript
const merged = merge([frontend, backend, security], { role: "summarizer" });
// merged.parent_ids = [frontend.id, backend.id, security.id]
```

### `handoff()` — 1 → 1
Transfer context to a different model or role.
```typescript
const verified = handoff(coded, { role: "verifier" });
```

### `shard()` — overflow management
Split long content across N parallel models, merge back.
```typescript
const shards = shard(root, 3, "summarizer");              // 3 parallel shards
const result = merge(shards, { role: "synthesizer" });    // merge back
```

### `verify()` — trust contract
Producer → Challenger → Synthesizer. Adversarial verification built into the protocol.
```typescript
const [challenger, synthesizer] = verify(
  producer,
  { role: "challenger" },
  { role: "synthesizer" }
);
// synthesizer.parent_ids = [producer.id, challenger.id]  ← DAG merge
```

## High-Level Pipeline Methods

```typescript
// Linear chain
await orc.runChain(task, ["architect", "coder", "verifier"]);

// Fork → Merge (parallel)
await orc.runParallel(task, ["reasoner", "coder"], "summarizer");

// Verify contract
await orc.runVerify(task, "architect", "challenger", "synthesizer");

// Shard long content
await orc.runSharded(task, "summarizer", 3, "synthesizer");
```

## Custom DAG

For full control, build the DAG manually and execute it:

```typescript
import { MMCPOrchestrator, fork, merge, handoff, verify } from "@mmcp/core";

const orc = new MMCPOrchestrator({ router, adapter: "mock" });

const root     = orc.root("Build SaaS dashboard", "architect");
const [fe, be] = fork(root, [{ role: "coder" }, { role: "reasoner" }]);
const verified = merge([fe, be], { role: "verifier" });
const final    = handoff(verified, { role: "summarizer" });

const result = await orc.execute([root, fe, be, verified, final]);
```

## Observability

MMCP emits structured events for every state transition:

```typescript
import { MMCPObserver } from "@mmcp/core";

const observer = new MMCPObserver();
observer.enableConsoleLogging(); // or:
observer.on((event) => {
  // event.type: mmcp.context.created | started | completed | failed | dag.completed
  myMonitoring.record(event);
});

const orc = new MMCPOrchestrator({ router, observer });
```

## Context Envelope

Every model invocation produces a Context Envelope — the core protocol primitive:

```typescript
interface ContextEnvelope {
  mmcp_version: "0.1";
  id: string;
  parent_ids: string[];    // ARRAY — DAG not tree
  children: string[];
  task: string;
  history: Message[];
  model: string;
  role: string;
  branch_type: "root" | "fork" | "merge" | "handoff" | "shard" | "verify";
  status: "pending" | "running" | "done" | "failed";
  confidence?: number;     // 0.0 – 1.0
  output?: string;
  tokens_used?: number;
  // ... timing, metadata
}
```

## Testing Without an API Key

Use `adapter: "mock"` to test pipelines without any API calls:

```typescript
const orc = new MMCPOrchestrator({ router, adapter: "mock" });
```

## Roadmap

- **v0.1** — Core DAG schema, 5 operations, TypeScript SDK, mock adapter ✅
- **v0.2** — Python SDK, Redis store, streaming, confidence scoring
- **v1.0** — Stable wire format, cross-vendor adapters, MMCP Registry

## Protocol Specification

See `MMCP_Protocol_Spec_v0.1.docx` for the full protocol specification including design rationale, compatibility table, and formal operation definitions.

## License

MIT
