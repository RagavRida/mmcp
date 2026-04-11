/**
 * Agent Coordinator — the missing layer that makes isolated agents collaborative.
 *
 * 50% of deployed agents operate in total isolation. This fixes that.
 *
 * Three primitives:
 *   1. SharedMemory — agents read/write shared context in real-time
 *   2. Handoff — transfer conversation + state from agent A to agent B
 *   3. Discovery — agents find each other by capability, not by name
 *
 * Works with ANY agent framework (LangChain, CrewAI, AutoGen, custom).
 * Drop-in: wrap your agent, it becomes collaborative.
 */

import { v4 as uuid } from "uuid";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AgentRegistration {
  agent_id: string;
  name: string;
  capabilities: string[];
  status: "online" | "busy" | "offline";
  metadata: Record<string, any>;
  /** The function to call when handing off to this agent */
  handler: (handoff: HandoffPayload) => Promise<HandoffResult>;
  registered_at: string;
  last_heartbeat: string;
}

export interface SharedMemoryEntry {
  key: string;
  value: any;
  written_by: string;
  written_at: string;
  ttl_ms?: number;
  version: number;
}

export interface HandoffPayload {
  from_agent: string;
  to_agent: string;
  conversation_id: string;
  /** Full conversation history */
  messages: Array<{ role: string; content: string; agent?: string }>;
  /** Shared context snapshot at handoff time */
  context: Record<string, any>;
  /** Why the handoff is happening */
  reason: string;
  /** Priority: normal, urgent, escalation */
  priority: "normal" | "urgent" | "escalation";
}

export interface HandoffResult {
  accepted: boolean;
  agent_id: string;
  response?: string;
  error?: string;
}

export interface CoordinationEvent {
  type: "agent:joined" | "agent:left" | "memory:write" | "memory:read" | "handoff:start" | "handoff:complete" | "handoff:failed" | "discovery:query";
  timestamp: string;
  agent_id: string;
  data: any;
}

export type CoordinationListener = (event: CoordinationEvent) => void;

// ── Coordinator ─────────────────────────────────────────────────────────────

export class AgentCoordinator {
  private agents = new Map<string, AgentRegistration>();
  private memory = new Map<string, SharedMemoryEntry>();
  private listeners: CoordinationListener[] = [];
  private handoff_log: HandoffPayload[] = [];

  // ── Agent Registry ──────────────────────────────────────────────────

  /** Register an agent so others can discover and hand off to it */
  register(config: {
    name: string;
    capabilities: string[];
    handler: (handoff: HandoffPayload) => Promise<HandoffResult>;
    metadata?: Record<string, any>;
  }): string {
    const agent_id = `agent_${uuid().slice(0, 8)}`;
    const now = new Date().toISOString();

    this.agents.set(agent_id, {
      agent_id,
      name: config.name,
      capabilities: config.capabilities,
      status: "online",
      metadata: config.metadata ?? {},
      handler: config.handler,
      registered_at: now,
      last_heartbeat: now,
    });

    this._emit({ type: "agent:joined", timestamp: now, agent_id, data: { name: config.name, capabilities: config.capabilities } });
    return agent_id;
  }

  /** Remove an agent */
  unregister(agent_id: string): void {
    this.agents.delete(agent_id);
    this._emit({ type: "agent:left", timestamp: new Date().toISOString(), agent_id, data: {} });
  }

  /** Heartbeat — agent reports it's still alive */
  heartbeat(agent_id: string): void {
    const agent = this.agents.get(agent_id);
    if (agent) {
      agent.last_heartbeat = new Date().toISOString();
      agent.status = "online";
    }
  }

  /** List all registered agents */
  listAgents(): AgentRegistration[] {
    return Array.from(this.agents.values()).map(a => ({ ...a, handler: a.handler }));
  }

  // ── Discovery ───────────────────────────────────────────────────────

  /** Find agents by capability — the core of coordination */
  discover(required_capabilities: string[]): AgentRegistration[] {
    const results: Array<{ agent: AgentRegistration; score: number }> = [];

    for (const agent of this.agents.values()) {
      if (agent.status === "offline") continue;
      const matched = required_capabilities.filter(c => agent.capabilities.includes(c));
      const score = matched.length / required_capabilities.length;
      if (score > 0) {
        results.push({ agent, score });
      }
    }

    this._emit({
      type: "discovery:query",
      timestamp: new Date().toISOString(),
      agent_id: "coordinator",
      data: { required: required_capabilities, found: results.length },
    });

    return results
      .sort((a, b) => b.score - a.score)
      .map(r => r.agent);
  }

  /** Find the single best agent for a set of capabilities */
  findBest(required_capabilities: string[]): AgentRegistration | null {
    const results = this.discover(required_capabilities);
    return results[0] ?? null;
  }

  // ── Shared Memory ───────────────────────────────────────────────────

  /** Write to shared memory — all agents can read it */
  write(agent_id: string, key: string, value: any, ttl_ms?: number): void {
    const existing = this.memory.get(key);
    const version = existing ? existing.version + 1 : 1;

    this.memory.set(key, {
      key,
      value,
      written_by: agent_id,
      written_at: new Date().toISOString(),
      ttl_ms,
      version,
    });

    this._emit({
      type: "memory:write",
      timestamp: new Date().toISOString(),
      agent_id,
      data: { key, version, ttl_ms },
    });
  }

  /** Read from shared memory */
  read(agent_id: string, key: string): any {
    const entry = this.memory.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (entry.ttl_ms) {
      const age = Date.now() - new Date(entry.written_at).getTime();
      if (age > entry.ttl_ms) {
        this.memory.delete(key);
        return undefined;
      }
    }

    this._emit({
      type: "memory:read",
      timestamp: new Date().toISOString(),
      agent_id,
      data: { key, version: entry.version, written_by: entry.written_by },
    });

    return entry.value;
  }

  /** Read all shared memory entries */
  readAll(): Map<string, SharedMemoryEntry> {
    // Evict expired entries
    const now = Date.now();
    for (const [key, entry] of this.memory) {
      if (entry.ttl_ms) {
        const age = now - new Date(entry.written_at).getTime();
        if (age > entry.ttl_ms) this.memory.delete(key);
      }
    }
    return new Map(this.memory);
  }

  // ── Handoff ─────────────────────────────────────────────────────────

  /** Hand off a conversation from one agent to another */
  async handoff(payload: HandoffPayload): Promise<HandoffResult> {
    const target = this.agents.get(payload.to_agent);

    if (!target) {
      // Try discovery by capability
      const capable = this.discover(["handle_" + payload.reason]);
      if (capable.length === 0) {
        this._emit({ type: "handoff:failed", timestamp: new Date().toISOString(), agent_id: payload.from_agent, data: { reason: "No target agent found" } });
        return { accepted: false, agent_id: payload.to_agent, error: "Agent not found" };
      }
      payload.to_agent = capable[0].agent_id;
    }

    const agent = this.agents.get(payload.to_agent)!;

    // Include shared memory snapshot in context
    payload.context = {
      ...payload.context,
      shared_memory: Object.fromEntries(this.readAll()),
    };

    this._emit({ type: "handoff:start", timestamp: new Date().toISOString(), agent_id: payload.from_agent, data: { to: payload.to_agent, reason: payload.reason } });
    this.handoff_log.push(payload);

    // Mark source as available, target as busy
    const source = this.agents.get(payload.from_agent);
    if (source) source.status = "online";
    agent.status = "busy";

    try {
      const result = await agent.handler(payload);
      agent.status = "online";
      this._emit({ type: "handoff:complete", timestamp: new Date().toISOString(), agent_id: payload.to_agent, data: { accepted: result.accepted } });
      return result;
    } catch (err) {
      agent.status = "online";
      const error = err instanceof Error ? err.message : String(err);
      this._emit({ type: "handoff:failed", timestamp: new Date().toISOString(), agent_id: payload.to_agent, data: { error } });
      return { accepted: false, agent_id: payload.to_agent, error };
    }
  }

  /** Auto-handoff: find the best agent for the task and hand off */
  async autoHandoff(
    from_agent: string,
    conversation_id: string,
    messages: HandoffPayload["messages"],
    required_capabilities: string[],
    reason: string,
  ): Promise<HandoffResult> {
    const best = this.findBest(required_capabilities);
    if (!best) {
      return { accepted: false, agent_id: "", error: "No capable agent found" };
    }

    return this.handoff({
      from_agent,
      to_agent: best.agent_id,
      conversation_id,
      messages,
      context: {},
      reason,
      priority: "normal",
    });
  }

  /** Get handoff history */
  getHandoffLog(): HandoffPayload[] {
    return [...this.handoff_log];
  }

  // ── Events ──────────────────────────────────────────────────────────

  /** Subscribe to coordination events */
  on(listener: CoordinationListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private _emit(event: CoordinationEvent): void {
    for (const l of this.listeners) l(event);
  }
}
