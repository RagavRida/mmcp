import { describe, it, expect } from "@jest/globals";
import { ExecutionPersistence } from "../src/engine/persistence";
import { ExecutionStateMachine } from "../src/engine/state_machine";
import { MultiVerifier, IntentAwareVerifier, BuiltinConstraints } from "../src/operations/verifier";
import { IdentityManager } from "../src/auth/identity";
import { ContextEngine } from "../src/engine/context_engine";

// ── Execution Persistence ────────────────────────────────────────────────────

describe("ExecutionPersistence", () => {

    it("creates a checkpoint from a state machine", () => {
        const sm = new ExecutionStateMachine();
        sm.transition("PLANNED");
        sm.transition("EXECUTING");

        const store = new ExecutionPersistence();
        const cp = store.checkpoint(sm, "ctx_001", {
            completed_node_ids: ["node_a"],
            pending_node_ids: ["node_b", "node_c"],
        });

        expect(cp.checkpoint_id).toMatch(/^cp_/);
        expect(cp.state).toBe("EXECUTING");
        expect(cp.completed_node_ids).toEqual(["node_a"]);
        expect(cp.pending_node_ids).toEqual(["node_b", "node_c"]);
        expect(cp.history).toHaveLength(2);
    });

    it("restores a state machine from checkpoint", () => {
        const sm = new ExecutionStateMachine();
        sm.transition("PLANNED");
        sm.transition("EXECUTING");
        sm.transition("VERIFYING");

        const store = new ExecutionPersistence();
        store.checkpoint(sm, "ctx_restore");

        const restored = store.restore("ctx_restore");
        expect(restored).not.toBeNull();
        expect(restored!.sm.getCurrentState()).toBe("VERIFYING");
        expect(restored!.checkpoint.state).toBe("VERIFYING");
    });

    it("returns null for unknown context", () => {
        const store = new ExecutionPersistence();
        expect(store.restore("nonexistent")).toBeNull();
    });

    it("serializes and deserializes checkpoints", () => {
        const sm = new ExecutionStateMachine();
        sm.transition("EXECUTING");

        const store = new ExecutionPersistence();
        store.checkpoint(sm, "ctx_serial", {
            shared_context_snapshot: { key: "value" },
        });

        const json = store.serialize();
        const store2 = new ExecutionPersistence();
        store2.deserialize(json);

        const restored = store2.restore("ctx_serial");
        expect(restored).not.toBeNull();
        expect(restored!.checkpoint.shared_context_snapshot).toEqual({ key: "value" });
    });

    it("tracks multiple checkpoints for same context", () => {
        const sm = new ExecutionStateMachine();
        const store = new ExecutionPersistence();

        sm.transition("PLANNED");
        store.checkpoint(sm, "ctx_multi");

        sm.transition("EXECUTING");
        store.checkpoint(sm, "ctx_multi");

        expect(store.getCheckpoints("ctx_multi")).toHaveLength(2);
        expect(store.getLatest("ctx_multi")!.state).toBe("EXECUTING");
        expect(store.size).toBe(2);
    });
});

// ── Multi-Verifier Voting ────────────────────────────────────────────────────

describe("MultiVerifier", () => {

    it("passes with majority voting (2/3 pass)", () => {
        const mv = new MultiVerifier("majority");

        const v1 = new IntentAwareVerifier();
        v1.addConstraint(BuiltinConstraints.minLength(5));

        const v2 = new IntentAwareVerifier();
        v2.addConstraint(BuiltinConstraints.minLength(5));

        const v3 = new IntentAwareVerifier();
        v3.addConstraint(BuiltinConstraints.containsKeywords(["nonexistent"]));

        mv.addVerifier("critic_1", v1);
        mv.addVerifier("critic_2", v2);
        mv.addVerifier("critic_3", v3);

        const result = mv.verify("Hello world", "Greet someone");
        expect(result.passed).toBe(true);
        expect(result.votes_passed).toBe(2);
        expect(result.votes_failed).toBe(1);
        expect(result.consensus).toBe("majority");
    });

    it("fails with unanimous voting when any critic fails", () => {
        const mv = new MultiVerifier("unanimous");

        const v1 = new IntentAwareVerifier();
        v1.addConstraint(BuiltinConstraints.minLength(5));

        const v2 = new IntentAwareVerifier();
        v2.addConstraint(BuiltinConstraints.containsKeywords(["nonexistent"]));

        mv.addVerifier("critic_1", v1);
        mv.addVerifier("critic_2", v2);

        const result = mv.verify("Hello world", "Greet");
        expect(result.passed).toBe(false);
        expect(result.votes_passed).toBe(1);
    });

    it("weighted voting uses verifier weights", () => {
        const mv = new MultiVerifier("weighted");

        const passes = new IntentAwareVerifier();
        passes.addConstraint(BuiltinConstraints.minLength(3));

        const fails = new IntentAwareVerifier();
        fails.addConstraint(BuiltinConstraints.containsKeywords(["nonexistent"]));

        // Weight 3 (passes) vs weight 1 (fails) = 75% → passes threshold 60%
        mv.addVerifier("heavy_pass", passes, 3);
        mv.addVerifier("light_fail", fails, 1);

        const result = mv.verify("Hello world", "Greet");
        expect(result.passed).toBe(true);
        expect(result.confidence).toBe(0.75);
    });

    it("size returns number of verifiers", () => {
        const mv = new MultiVerifier();
        expect(mv.size).toBe(0);
        mv.addVerifier("v1", new IntentAwareVerifier());
        expect(mv.size).toBe(1);
    });
});

// ── Identity & Auth ──────────────────────────────────────────────────────────

describe("IdentityManager", () => {

    it("creates and authenticates API keys", () => {
        const mgr = new IdentityManager();
        const { api_key, key_id } = mgr.createKey("user_1", ["execute", "read"]);

        expect(api_key).toMatch(/^mmcp_/);
        expect(key_id).toMatch(/^key_/);

        const auth = mgr.authenticate(api_key);
        expect(auth.authenticated).toBe(true);
        expect(auth.owner).toBe("user_1");
        expect(auth.permissions).toContain("execute");
    });

    it("rejects invalid API keys", () => {
        const mgr = new IdentityManager();
        const auth = mgr.authenticate("bad_key");
        expect(auth.authenticated).toBe(false);
        expect(auth.error).toBe("Invalid API key");
    });

    it("revokes API keys", () => {
        const mgr = new IdentityManager();
        const { api_key, key_id } = mgr.createKey("user_1", ["execute"]);

        expect(mgr.revokeKey(key_id)).toBe(true);

        const auth = mgr.authenticate(api_key);
        expect(auth.authenticated).toBe(false);
        expect(auth.error).toBe("API key has been revoked");
    });

    it("rejects expired API keys", () => {
        const mgr = new IdentityManager();
        const { api_key } = mgr.createKey("user_1", ["execute"], {
            expires_at: "2020-01-01T00:00:00Z",
        });

        const auth = mgr.authenticate(api_key);
        expect(auth.authenticated).toBe(false);
        expect(auth.error).toBe("API key has expired");
    });

    it("authorize checks permissions", () => {
        const mgr = new IdentityManager();
        const { api_key } = mgr.createKey("user_1", ["execute", "read"]);

        const auth = mgr.authenticate(api_key);
        expect(mgr.authorize(auth, "execute")).toBe(true);
        expect(mgr.authorize(auth, "admin")).toBe(false);
        expect(mgr.authorize(auth, "write")).toBe(false);
    });

    it("admin permission grants all access", () => {
        const mgr = new IdentityManager();
        const { api_key } = mgr.createKey("admin_user", ["admin"]);

        const auth = mgr.authenticate(api_key);
        expect(mgr.authorize(auth, "execute")).toBe(true);
        expect(mgr.authorize(auth, "read")).toBe(true);
        expect(mgr.authorize(auth, "write")).toBe(true);
        expect(mgr.authorize(auth, "admin")).toBe(true);
    });

    it("listKeys returns keys for owner", () => {
        const mgr = new IdentityManager();
        mgr.createKey("user_1", ["execute"]);
        mgr.createKey("user_1", ["read"]);
        mgr.createKey("user_2", ["admin"]);

        const user1Keys = mgr.listKeys("user_1");
        expect(user1Keys).toHaveLength(2);
        // Ensure key_hash is not exposed
        user1Keys.forEach(k => {
            expect(k).not.toHaveProperty("key_hash");
        });
    });

    it("size and clear work correctly", () => {
        const mgr = new IdentityManager();
        mgr.createKey("u1", ["execute"]);
        mgr.createKey("u2", ["read"]);
        expect(mgr.size).toBe(2);
        mgr.clear();
        expect(mgr.size).toBe(0);
    });
});

// ── Context Engine Semantic Memory ───────────────────────────────────────────

describe("ContextEngine Semantic Memory", () => {

    it("setTaskEmbedding and findByEmbedding", () => {
        const engine = new ContextEngine();
        const t1 = engine.createTask("s1", "Build JWT auth");
        const t2 = engine.createTask("s1", "Deploy to AWS");
        const t3 = engine.createTask("s1", "Fix login CSS");

        engine.setTaskEmbedding(t1.task_id, [1, 0, 0]);
        engine.setTaskEmbedding(t2.task_id, [0, 1, 0]);
        engine.setTaskEmbedding(t3.task_id, [0.9, 0.1, 0]);

        const results = engine.findByEmbedding([1, 0, 0], 5, 0.5);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].task.task_id).toBe(t1.task_id);
        expect(results[0].similarity).toBeCloseTo(1);
    });

    it("cosineSimilarity computes correctly", () => {
        expect(ContextEngine.cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
        expect(ContextEngine.cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
        expect(ContextEngine.cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
        expect(ContextEngine.cosineSimilarity([], [])).toBe(0);
    });
});
