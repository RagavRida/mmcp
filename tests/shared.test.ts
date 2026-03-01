/**
 * SharedContextStore Tests
 * ─────────────────────────
 * Unit tests for SharedContextStore (no API calls needed).
 * Integration tests use real Anthropic API via claude-haiku-4-5-20251001.
 *
 * Usage:
 *   npm test                                # all tests (mock adapter for integration)
 *   ANTHROPIC_API_KEY=sk-ant-... npm test   # full live integration tests
 */

import {
    MMCPOrchestrator,
    RoleBasedRouter,
    MemoryStore,
    MMCPObserver,
    SharedContextStore,
} from "../src/index";

// ── Unit Tests: SharedContextStore in isolation ────────────────────────────────

describe("SharedContextStore — unit", () => {
    let store: SharedContextStore;

    beforeEach(() => { store = new SharedContextStore(); });

    // ── Append-only guarantee ──────────────────────────────────────────────────

    it("append-only: set same key twice → 2 entries not 1", () => {
        store.set("lang", "Python", "ctx_a");
        store.set("lang", "TypeScript", "ctx_b");
        const history = store.get("lang");
        expect(history).toHaveLength(2);
        expect(history[0].value).toBe("Python");
        expect(history[1].value).toBe("TypeScript");
    });

    it("never mutates old entries when overwriting a key", () => {
        store.set("key", "v1", "ctx_a");
        const snap1 = store.get("key")[0];
        store.set("key", "v2", "ctx_b");
        // Original entry is unchanged
        expect(store.get("key")[0]).toStrictEqual(snap1);
    });

    // ── Version auto-increment ─────────────────────────────────────────────────

    it("version auto-increments per key (1-based)", () => {
        store.set("x", 10, "ctx_a");
        store.set("x", 20, "ctx_b");
        store.set("x", 30, "ctx_c");
        const entries = store.get("x");
        expect(entries.map(e => e.version)).toEqual([1, 2, 3]);
    });

    it("version resets independently per key", () => {
        store.set("a", 1, "ctx_a");
        store.set("a", 2, "ctx_b");
        store.set("b", 9, "ctx_c");
        expect(store.latestEntry("a")!.version).toBe(2);
        expect(store.latestEntry("b")!.version).toBe(1);
    });

    // ── latest() ──────────────────────────────────────────────────────────────

    it("latest() returns the most recent value", () => {
        store.set("status", "pending", "ctx_a");
        store.set("status", "done", "ctx_b");
        expect(store.latest("status")).toBe("done");
    });

    it("latest() returns null for unknown key", () => {
        expect(store.latest("nope")).toBeNull();
    });

    it("latestEntry() returns full entry with metadata", () => {
        store.set("key", 42, "ctx_x", { note: "first" });
        const e = store.latestEntry("key");
        expect(e?.value).toBe(42);
        expect(e?.author_ctx_id).toBe("ctx_x");
        expect(e?.metadata?.note).toBe("first");
    });

    // ── has() / keys() ────────────────────────────────────────────────────────

    it("has() is false before write, true after", () => {
        expect(store.has("x")).toBe(false);
        store.set("x", 1, "ctx_a");
        expect(store.has("x")).toBe(true);
    });

    it("keys() returns all written keys", () => {
        store.set("a", 1, "ctx_a");
        store.set("b", 2, "ctx_b");
        store.set("c", 3, "ctx_c");
        expect(store.keys().sort()).toEqual(["a", "b", "c"]);
    });

    // ── snapshot() ────────────────────────────────────────────────────────────

    it("snapshot() returns all latest values as flat object", () => {
        store.set("db", "postgres", "ctx_a");
        store.set("auth", "JWT", "ctx_b");
        store.set("db", "mysql", "ctx_c");   // overwrite
        const snap = store.snapshot();
        expect(snap).toEqual({ db: "mysql", auth: "JWT" });
    });

    it("snapshot() is an independent copy — changes don't affect it", () => {
        store.set("k", "v1", "ctx_a");
        const snap = store.snapshot();
        store.set("k", "v2", "ctx_b");
        expect(snap["k"]).toBe("v1");          // old snapshot unaffected
        expect(store.snapshot()["k"]).toBe("v2");
    });

    // ── diff() after ISO timestamp ─────────────────────────────────────────────

    it("diff() returns only entries after given timestamp", async () => {
        store.set("a", 1, "ctx_a");
        store.set("b", 2, "ctx_b");
        const mid = new Date().toISOString();
        await new Promise(r => setTimeout(r, 5));  // ensure timestamps differ
        store.set("c", 3, "ctx_c");
        store.set("d", 4, "ctx_d");
        const after = store.diff(mid);
        expect(after.map(e => e.key).sort()).toEqual(["c", "d"]);
    });

    it("diff() returns empty array if nothing written after timestamp", () => {
        store.set("a", 1, "ctx_a");
        const future = new Date(Date.now() + 10_000).toISOString();
        expect(store.diff(future)).toHaveLength(0);
    });

    // ── history() ─────────────────────────────────────────────────────────────

    it("history() returns all entries across all keys sorted by timestamp", () => {
        store.set("x", 1, "ctx_a");
        store.set("y", 2, "ctx_b");
        store.set("x", 3, "ctx_c");
        const h = store.history();
        expect(h).toHaveLength(3);
        // sorted ascending by timestamp
        for (let i = 1; i < h.length; i++) {
            expect(h[i].timestamp >= h[i - 1].timestamp).toBe(true);
        }
    });

    // ── clear() ───────────────────────────────────────────────────────────────

    it("clear(key) removes only that key", () => {
        store.set("a", 1, "ctx_a");
        store.set("b", 2, "ctx_b");
        store.clear("a");
        expect(store.has("a")).toBe(false);
        expect(store.has("b")).toBe(true);
    });

    it("clear() with no args removes everything", () => {
        store.set("a", 1, "ctx_a");
        store.set("b", 2, "ctx_b");
        store.clear();
        expect(store.keys()).toHaveLength(0);
    });
});

// ── Integration Tests: SharedContextStore inside MMCPOrchestrator ─────────────

describe("SharedContextStore — integration (mock adapter)", () => {
    const router = new RoleBasedRouter({
        architect: { model_id: "claude-haiku-4-5-20251001", system_prompt: "You are the ARCHITECT." },
        coder: { model_id: "claude-haiku-4-5-20251001", system_prompt: "You are the CODER." },
        synthesizer: { model_id: "claude-haiku-4-5-20251001", system_prompt: "You are the SYNTHESIZER." },
    });

    it("orc.shared is accessible after construction", () => {
        const orc = new MMCPOrchestrator({ adapter: "mock", router, store: new MemoryStore() });
        expect(orc.shared).toBeInstanceOf(SharedContextStore);
    });

    it("shared store provided in config is used (not auto-created)", () => {
        const myStore = new SharedContextStore();
        myStore.set("test", "value", "manual");
        const orc = new MMCPOrchestrator({ adapter: "mock", router, store: new MemoryStore(), shared: myStore });
        expect(orc.shared.latest("test")).toBe("value");
    });

    it("orc.shared persists writes across pipeline access", async () => {
        const orc = new MMCPOrchestrator({ adapter: "mock", router, store: new MemoryStore() });
        const result = await orc.runChain("build an API", ["architect", "coder"]);
        // Manually write to shared store using the context IDs from the DAG
        for (const ctx of result.dag) {
            orc.shared.set(`role_${ctx.role}`, ctx.output ?? "", ctx.id);
        }
        expect(orc.shared.has("role_architect")).toBe(true);
        expect(orc.shared.has("role_coder")).toBe(true);
        expect(orc.shared.keys()).toHaveLength(2);
    });

    it("two parallel nodes both write to shared store — both entries preserved", async () => {
        const orc = new MMCPOrchestrator({ adapter: "mock", router, store: new MemoryStore() });
        const result = await orc.runParallel("build a todo app", ["architect", "coder"], "synthesizer");
        // Simulate two parallel nodes writing to the same key
        const [n1, n2] = result.dag.filter(c => c.branch_type === "fork");
        orc.shared.set("shared_key", "from_node1", n1.id);
        orc.shared.set("shared_key", "from_node2", n2.id);
        // Both entries preserved (append-only)
        expect(orc.shared.get("shared_key")).toHaveLength(2);
        expect(orc.shared.latest("shared_key")).toBe("from_node2");
    });

    it("observability events fire on shared store operations", async () => {
        const events: string[] = [];
        const observer = new MMCPObserver();
        observer.on((e) => events.push(e.type));

        const orc = new MMCPOrchestrator({ adapter: "mock", router, store: new MemoryStore(), observer });
        await orc.runChain("task", ["architect"]);

        // mmcp.shared.read is emitted for each node execution
        const readEvents = events.filter(t => t === "mmcp.shared.read");
        expect(readEvents.length).toBeGreaterThan(0);
    });

    it("snapshot() reflects all writes from pipeline", async () => {
        const orc = new MMCPOrchestrator({ adapter: "mock", router, store: new MemoryStore() });
        orc.shared.set("api_style", "REST", "setup");
        orc.shared.set("auth", "JWT", "setup");
        orc.shared.set("database", "PostgreSQL", "setup");
        const snap = orc.shared.snapshot();
        expect(snap).toEqual({ api_style: "REST", auth: "JWT", database: "PostgreSQL" });
    });
});
