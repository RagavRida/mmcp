# MMCP Protocol Specification v2.1

**Multi-Model Collaboration Pipeline — Protocol RFC**

> Status: **DRAFT**
> Version: **2.1**
> Date: **2026-03-19**

---

## 1. Overview

MMCP is a protocol for orchestrating **multi-model AI pipelines** where different LLMs collaborate via structured message passing. It enables:

- **Inter-agent communication** via typed protocol messages
- **Distributed tracing** across multi-node agent networks
- **State machine-driven execution** with crash recovery
- **Self-improving routing** via reinforcement learning
- **Multi-verifier consensus** for enterprise reliability

## 2. Message Schema

Every MMCP message MUST conform to the following structure:

```json
{
  "mmcp_version": "2.0",
  "schema_version": "2.0",
  "message_id": "msg_<uuid>",
  "trace_id": "trace_<uuid>",
  "parent_message_id": "msg_<uuid>",    // optional
  "idempotency_key": "<string>",         // optional
  "sender": "<agent_id | role>",
  "receiver": "<agent_id | role>",
  "task_id": "<string>",
  "intent": "<MessageIntent>",
  "payload": {},
  "context_id": "ctx_<uuid>",
  "confidence": 0.0,
  "status": "<MessageStatus>",
  "timestamp": "<ISO 8601>",
  "metadata": {}
}
```

### 2.1 Field Requirements

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `mmcp_version` | ✅ | `"2.0"` | Protocol version (fixed) |
| `schema_version` | ✅ | `"2.0"` | Schema version for forward compatibility |
| `message_id` | ✅ | `string` | Unique ID, must start with `msg_` |
| `trace_id` | ✅ | `string` | Global execution trace, starts with `trace_` |
| `parent_message_id` | ❌ | `string` | Links to parent message for DAG lineage |
| `idempotency_key` | ❌ | `string` | Deduplication key for retries |
| `sender` | ✅ | `string` | Agent ID or role name |
| `receiver` | ✅ | `string` | Target agent ID or role name |
| `task_id` | ✅ | `string` | Pipeline task identifier |
| `intent` | ✅ | `MessageIntent` | What the sender wants |
| `payload` | ✅ | `object` | Task-specific data |
| `context_id` | ✅ | `string` | Links to `ContextEnvelope.id` |
| `confidence` | ✅ | `number` | 0.0–1.0 confidence score |
| `status` | ✅ | `MessageStatus` | Current message state |
| `timestamp` | ✅ | `string` | ISO 8601 datetime |
| `metadata` | ❌ | `object` | Arbitrary key-value pairs |

### 2.2 Intent Types

```
code_generation | review | verification | analysis | synthesis
classification | summarization | planning | execution | handoff | custom
```

### 2.3 Status Values

```
pending → success | failed | retry
```

## 3. State Machine

Every pipeline execution follows this state machine:

```
INIT → PLANNED → EXECUTING → VERIFYING → DONE
                     ↓                      ↑
                   FAILED ←─────────────────┘
```

### 3.1 Valid Transitions

| From | To | Trigger |
|------|----|---------|
| `INIT` | `PLANNED` | Pipeline plan created |
| `INIT` | `EXECUTING` | Direct execution (skip planning) |
| `PLANNED` | `EXECUTING` | Execution begins |
| `EXECUTING` | `VERIFYING` | All nodes complete |
| `EXECUTING` | `FAILED` | Node failure |
| `VERIFYING` | `DONE` | Verification passed |
| `VERIFYING` | `FAILED` | Verification failed |
| `VERIFYING` | `EXECUTING` | Retry after verification failure |
| `FAILED` | `EXECUTING` | Retry from failure |

### 3.2 Checkpointing

Execution state MAY be checkpointed at any transition. A checkpoint contains:

```json
{
  "checkpoint_id": "cp_<timestamp>_<random>",
  "ctx_id": "<context_id>",
  "state": "<ExecutionState>",
  "history": [{ "from": "INIT", "to": "PLANNED", "timestamp": "..." }],
  "completed_node_ids": ["node_a"],
  "pending_node_ids": ["node_b"],
  "shared_context_snapshot": {}
}
```

## 4. Agent API

### 4.1 Agent Interface

Every MMCP agent MUST implement:

```typescript
interface MMCPAgent {
  id: string;
  name: string;
  capabilities: string[];
  execute(message: MMCPMessage): Promise<MMCPMessage>;
}
```

### 4.2 HTTP Protocol

External agents are accessed via HTTP:

```
POST /mmcp/execute
Content-Type: application/json
Authorization: Bearer <api_key>

{
  "intent": "code_generation",
  "task": "Write a fibonacci function",
  "context": {},
  "trace_id": "trace_abc",
  "timeout_ms": 30000
}

→ 200 OK
{
  "status": "success",
  "output": "...",
  "confidence": 0.95,
  "model_used": "claude-sonnet-4",
  "tokens_used": 200,
  "latency_ms": 1500,
  "cost_usd": 0.003,
  "message": { <MMCPMessage> }
}
```

```
GET /mmcp/health → { agent_id, status, uptime_ms, success_rate }
GET /mmcp/capabilities → { agent_id, capabilities[] }
```

### 4.3 Agent Discovery

Agents in the network mesh are discovered by:
- **Capability** — find agents that support specific intents
- **Region** — geographic proximity
- **Health** — exclude degraded/offline nodes

## 5. Retry Semantics

### 5.1 Message-Level Retry

When `status = "retry"`, the sender SHOULD:
1. Increment a retry counter in `metadata.retry_count`
2. Set `idempotency_key` to the original key (for dedup)
3. Optionally switch models per `retry_recommendation.switch_model`

### 5.2 Pipeline-Level Retry

When a node fails:
1. State machine transitions to `FAILED`
2. Checkpoint is created automatically
3. Pipeline MAY retry from checkpoint: `FAILED → EXECUTING`
4. Only pending nodes are re-executed

### 5.3 Idempotency

Receivers MUST check `idempotency_key` if present. If a message with the same key was already processed, the receiver MUST return the cached response without re-execution.

## 6. Network Mesh

### 6.1 Node Registration

```json
{
  "node_id": "node_abc123",
  "name": "India Agent",
  "region": "ap-south",
  "endpoint": "https://india.mmcp.io",
  "capabilities": ["code_generation", "analysis"],
  "status": "online",
  "latency_ms": 50,
  "load": 0.3
}
```

### 6.2 Routing Strategies

| Strategy | Algorithm |
|----------|-----------|
| `nearest` | Sort by latency, pick lowest |
| `least_loaded` | Sort by load factor, pick lowest |
| `capability_match` | Score: `cap_coverage × (1 - load) / latency` |
| `round_robin` | Cycle through available nodes |

### 6.3 Heartbeat

Nodes send heartbeats every 30 seconds with:
- `node_id`
- `status`: `online | degraded | offline`
- `load`: 0.0–1.0

## 7. Verification

### 7.1 Constraint Types

| Type | Description |
|------|-------------|
| `contains` | Output must include specific keywords |
| `format` | Output must match format (JSON, code, etc.) |
| `security` | No security anti-patterns (eval, hardcoded creds) |
| `logic` | Output addresses the original intent |
| `custom` | User-defined constraint function |

### 7.2 Multi-Verifier Voting

Multiple verifiers reach consensus via:

| Strategy | Rule |
|----------|------|
| `majority` | >50% weighted votes pass |
| `unanimous` | All verifiers must pass |
| `weighted` | ≥60% of weighted votes pass |

## 8. Routing (RL-Ready)

### 8.1 Composite Score

```
score = w_accuracy × success_rate - w_latency × latency_norm - w_cost × cost_norm
```

### 8.2 UCB1 Exploration

```
ucb(model) = score(model) + C × √(ln(N) / n_i)
```

Where `N` = total invocations, `n_i` = invocations for model `i`, `C` = exploration constant.

### 8.3 Epsilon-Greedy

```
if random() < ε: explore (random model)
else: exploit (highest UCB score)
ε = max(ε_min, ε × decay)    // decay per invocation
```

## 9. Authentication

### 9.1 API Keys

```
mmcp_<uuid>  →  hash  →  stored
```

### 9.2 Permissions

```
execute | read | write | admin | verify | route | agent:register | agent:execute
```

`admin` grants all permissions. Keys can be revoked or expired.

---

**End of MMCP v2.1 Protocol Specification**
