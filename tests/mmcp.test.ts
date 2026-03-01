import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  MMCPOrchestrator, RoleBasedRouter, MemoryStore, MMCPObserver,
  fork, merge, handoff, shard, verify,
  createContext
} from "../src/index";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOrchestrator() {
  return new MMCPOrchestrator({
    router: new RoleBasedRouter({
      architect: { model_id: "claude-sonnet-4-20250514" },
      coder: { model_id: "claude-sonnet-4-20250514" },
      verifier: { model_id: "claude-sonnet-4-20250514" },
      summarizer: { model_id: "claude-sonnet-4-20250514" },
      challenger: { model_id: "claude-sonnet-4-20250514" },
      synthesizer: { model_id: "claude-sonnet-4-20250514" },
      reasoner: { model_id: "claude-sonnet-4-20250514" },
      orchestrator: { model_id: "claude-sonnet-4-20250514" },
    }),
    store: new MemoryStore(),
    adapter: "mock",
  });
}

// ── Unit Tests: Context ───────────────────────────────────────────────────────

describe("ContextEnvelope", () => {
  it("creates a context with correct defaults", () => {
    const ctx = createContext({ task: "test", role: "architect", model: "claude" });
    expect(ctx.mmcp_version).toBe("1.0");
    expect(ctx.status).toBe("pending");
    expect(ctx.parent_ids).toEqual([]);
    expect(ctx.children).toEqual([]);
    expect(ctx.branch_type).toBe("handoff");
    expect(ctx.retry_count).toBe(0);
    expect(ctx.id).toMatch(/^ctx_/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () =>
      createContext({ task: "t", role: "r", model: "m" }).id
    ));
    expect(ids.size).toBe(100);
  });
});

// ── Unit Tests: Operations ────────────────────────────────────────────────────

describe("fork()", () => {
  it("creates N children from one parent", () => {
    const parent = createContext({ task: "build API", role: "architect", model: "claude", branch_type: "root" });
    const children = fork(parent, [
      { role: "frontend" }, { role: "backend" }, { role: "security" }
    ]);
    expect(children).toHaveLength(3);
    children.forEach(child => {
      expect(child.parent_ids).toEqual([parent.id]);
      expect(child.branch_type).toBe("fork");
      expect(child.depth).toBe(1);
    });
    expect(children.map(c => c.role)).toEqual(["frontend", "backend", "security"]);
  });
});

describe("merge()", () => {
  it("creates a node with multiple parent_ids — the DAG primitive", () => {
    const p1 = createContext({ task: "t", role: "a", model: "m" });
    const p2 = createContext({ task: "t", role: "b", model: "m" });
    p1.status = "done"; p1.output = "output A";
    p2.status = "done"; p2.output = "output B";

    const merged = merge([p1, p2], { role: "summarizer" });
    expect(merged.parent_ids).toHaveLength(2);
    expect(merged.parent_ids).toContain(p1.id);
    expect(merged.parent_ids).toContain(p2.id);
    expect(merged.branch_type).toBe("merge");
  });

  it("throws when given no parents", () => {
    expect(() => merge([], { role: "summarizer" })).toThrow();
  });
});

describe("handoff()", () => {
  it("creates a 1→1 context transfer", () => {
    const parent = createContext({ task: "t", role: "coder", model: "m" });
    const child = handoff(parent, { role: "verifier" });
    expect(child.parent_ids).toEqual([parent.id]);
    expect(child.role).toBe("verifier");
    expect(child.branch_type).toBe("handoff");
    expect(child.depth).toBe(parent.depth + 1);
  });
});

describe("shard()", () => {
  it("creates N shards with correct metadata", () => {
    const parent = createContext({ task: "summarize 10k doc", role: "orchestrator", model: "m" });
    const shards = shard(parent, 4, "summarizer");
    expect(shards).toHaveLength(4);
    shards.forEach((s, i) => {
      expect(s.branch_type).toBe("shard");
      expect(s.shard_index).toBe(i);
      expect(s.parent_ids).toEqual([parent.id]);
    });
  });
});

describe("verify()", () => {
  it("creates challenger + synthesizer with correct DAG structure", () => {
    const producer = createContext({ task: "Is X true?", role: "architect", model: "m", branch_type: "root" });
    const [challenger, synthesizer] = verify(
      producer,
      { role: "challenger" },
      { role: "synthesizer" }
    );
    // Challenger has only producer as parent
    expect(challenger.parent_ids).toEqual([producer.id]);
    expect(challenger.branch_type).toBe("verify");
    // Synthesizer has BOTH producer and challenger as parents — this is the DAG
    expect(synthesizer.parent_ids).toContain(producer.id);
    expect(synthesizer.parent_ids).toContain(challenger.id);
    expect(synthesizer.parent_ids).toHaveLength(2);
  });
});

// ── Integration Tests: Orchestrator ──────────────────────────────────────────

describe("MMCPOrchestrator", () => {
  it("runChain: executes a linear pipeline", async () => {
    const orc = makeOrchestrator();
    const result = await orc.runChain("Build a REST API", ["architect", "coder", "verifier"]);
    expect(result.success).toBe(true);
    expect(result.total_nodes).toBe(3);
    expect(result.output).toContain("[MOCK]");
    expect(result.total_tokens).toBeGreaterThan(0);
  });

  it("runParallel: executes fork → merge", async () => {
    const orc = makeOrchestrator();
    const result = await orc.runParallel(
      "Analyze microservices",
      ["reasoner", "coder"],
      "summarizer"
    );
    expect(result.success).toBe(true);
    expect(result.total_nodes).toBe(4); // root + 2 forks + merge
  });

  it("runVerify: producer → challenger → synthesizer", async () => {
    const orc = makeOrchestrator();
    const result = await orc.runVerify(
      "Is recursion slower than iteration?",
      "architect",
      "challenger",
      "synthesizer"
    );
    expect(result.success).toBe(true);
    expect(result.total_nodes).toBe(3);
    expect(result.dag.find(c => c.role === "synthesizer")?.parent_ids).toHaveLength(2);
  });

  it("runSharded: shard → merge", async () => {
    const orc = makeOrchestrator();
    const result = await orc.runSharded("Summarize history of internet", "summarizer", 3, "synthesizer");
    expect(result.success).toBe(true);
    expect(result.total_nodes).toBe(5); // root + 3 shards + merge
  });

  it("emits observability events", async () => {
    const observer = new MMCPObserver();
    const events: string[] = [];
    observer.on(e => events.push(e.type));

    const orc = new MMCPOrchestrator({
      router: new RoleBasedRouter({ architect: { model_id: "claude-sonnet-4-20250514" } }),
      store: new MemoryStore(),
      adapter: "mock",
      observer,
    });

    await orc.runChain("test", ["architect"]);

    expect(events).toContain("mmcp.dag.started");
    expect(events).toContain("mmcp.context.started");
    expect(events).toContain("mmcp.context.completed");
    expect(events).toContain("mmcp.dag.completed");
  });

  it("DAG result contains all context envelopes", async () => {
    const orc = makeOrchestrator();
    const result = await orc.runChain("test", ["architect", "coder"]);
    expect(result.dag).toHaveLength(2);
    result.dag.forEach(ctx => {
      expect(ctx.status).toBe("done");
      expect(ctx.output).toBeTruthy();
      expect(ctx.tokens_used).toBeGreaterThan(0);
    });
  });
});
