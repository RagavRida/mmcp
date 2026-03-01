import { config } from "dotenv";
config();

import { describe, it, expect } from "@jest/globals";
import {
    MMCPOrchestrator, RoleBasedRouter, MemoryStore,
    createContext, fork, merge, handoff,
} from "../src/index";
import {
    MMCPWireFormat, WireEnvelope, WireDAG,
    MODEL_PRICING,
} from "../src/wire/format";
import { AdapterRegistry, MMCPAdapterError } from "../src/adapters/registry";
import { AnthropicAdapter } from "../src/adapters/anthropic";
import { OpenAIAdapter } from "../src/adapters/openai";
import { OpenRouterAdapter } from "../src/adapters/openrouter";
import { GoogleAdapter } from "../src/adapters/google";
import { MMCPRegistry } from "../src/registry/index";
import { MMCPComplianceSuite } from "../src/compliance/suite";
import { ContextEnvelope } from "../src/core/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOrc() {
    return new MMCPOrchestrator({
        router: new RoleBasedRouter({
            architect: { model_id: "claude-haiku-4-5-20251001" },
            coder: { model_id: "claude-haiku-4-5-20251001" },
            verifier: { model_id: "claude-haiku-4-5-20251001" },
            summarizer: { model_id: "claude-haiku-4-5-20251001" },
            challenger: { model_id: "claude-haiku-4-5-20251001" },
            synthesizer: { model_id: "claude-haiku-4-5-20251001" },
            orchestrator: { model_id: "claude-haiku-4-5-20251001" },
            security_analyst: { model_id: "claude-haiku-4-5-20251001" },
            performance_analyst: { model_id: "claude-haiku-4-5-20251001" },
        }),
        store: new MemoryStore(),
        adapter: "mock",
        regulation_tags: ["SOC2"],
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// Wire Format Tests
// ══════════════════════════════════════════════════════════════════════════════

describe("Wire Format", () => {
    const wf = new MMCPWireFormat();

    it("serialize/deserialize round-trip preserves all fields", () => {
        const ctx = createContext({
            task: "round trip test",
            role: "tester",
            model: "claude-haiku-4-5-20251001",
        });
        ctx.status = "done";
        ctx.output = "test output";
        ctx.completed_at = new Date().toISOString();
        ctx.tokens_used = 500;

        const wire1 = wf.serialize(ctx);
        const deserialized = wf.deserialize(wire1);
        const wire2 = wf.serialize(deserialized);

        expect(wire1.id).toBe(wire2.id);
        expect(wire1.output).toBe(wire2.output);
        expect(wire1.compliance.audit_hash).toBe(wire2.compliance.audit_hash);
        expect(wire1.mmcp).toBe("1.0");
        expect(wire1.schema).toBe("https://mmcp.dev/schema/1.0/envelope.json");
    });

    it("audit_hash is deterministic", () => {
        const ctx = createContext({ task: "hash test", role: "t", model: "claude-haiku-4-5-20251001" });
        ctx.output = "same output";
        ctx.completed_at = "2024-01-01T00:00:00Z";

        const h1 = MMCPWireFormat.computeAuditHash(ctx.id, ctx.parent_ids, ctx.output, ctx.completed_at);
        const h2 = MMCPWireFormat.computeAuditHash(ctx.id, ctx.parent_ids, ctx.output, ctx.completed_at);
        expect(h1).toBe(h2);
        expect(h1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("audit_hash changes when output changes", () => {
        const h1 = MMCPWireFormat.computeAuditHash("id1", [], "output_A", "2024-01-01");
        const h2 = MMCPWireFormat.computeAuditHash("id1", [], "output_B", "2024-01-01");
        expect(h1).not.toBe(h2);
    });

    it("cost_usd calculated correctly for haiku", () => {
        // haiku: input=0.25/1M, output=1.25/1M
        const cost = MMCPWireFormat.calculateCost("claude-haiku-4-5-20251001", 10000, 5000);
        // (10000/1M * 0.25) + (5000/1M * 1.25) = 0.0025 + 0.00625 = 0.00875
        expect(cost).toBeCloseTo(0.00875, 5);
    });

    it("WireDAG total_cost_usd equals sum of envelopes", () => {
        const ctx1 = createContext({ task: "a", role: "r", model: "claude-haiku-4-5-20251001" });
        ctx1.status = "done"; ctx1.output = "a"; ctx1.tokens_used = 100;
        const ctx2 = createContext({ task: "b", role: "r", model: "claude-haiku-4-5-20251001" });
        ctx2.status = "done"; ctx2.output = "b"; ctx2.tokens_used = 200;

        const dag = wf.serializeDAG([ctx1, ctx2]);
        const sum = dag.envelopes.reduce((s, e) => s + (e.cost_usd ?? 0), 0);
        expect(dag.total_cost_usd).toBeCloseTo(sum, 8);
    });

    it("validate returns errors for tampered envelope", () => {
        const ctx = createContext({ task: "t", role: "r", model: "claude-haiku-4-5-20251001" });
        ctx.status = "done"; ctx.output = "original";
        const wire = wf.serialize(ctx);
        wire.output = "tampered";
        const result = wf.validate(wire);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.code === "CA-007")).toBe(true);
    });

    it("deserialize throws on audit_hash mismatch", () => {
        const ctx = createContext({ task: "t", role: "r", model: "claude-haiku-4-5-20251001" });
        ctx.status = "done"; ctx.output = "original"; ctx.completed_at = new Date().toISOString();
        const wire = wf.serialize(ctx);
        wire.output = "tampered";
        expect(() => wf.deserialize(wire)).toThrow("WireFormatError");
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// Adapter Registry Tests
// ══════════════════════════════════════════════════════════════════════════════

describe("AdapterRegistry", () => {
    it("detects anthropic from claude-*", () => {
        expect(AdapterRegistry.detectVendor("claude-haiku-4-5-20251001")).toBe("anthropic");
        expect(AdapterRegistry.detectVendor("claude-sonnet-4-20250514")).toBe("anthropic");
        expect(AdapterRegistry.detectVendor("claude-opus-4-20250514")).toBe("anthropic");
    });

    it("detects openai from gpt-*/o1-*/o3-*", () => {
        expect(AdapterRegistry.detectVendor("gpt-4o")).toBe("openai");
        expect(AdapterRegistry.detectVendor("gpt-4o-mini")).toBe("openai");
        expect(AdapterRegistry.detectVendor("o1-preview")).toBe("openai");
        expect(AdapterRegistry.detectVendor("o3-mini")).toBe("openai");
    });

    it("detects google from gemini-*", () => {
        expect(AdapterRegistry.detectVendor("gemini-pro-1.5")).toBe("google");
        expect(AdapterRegistry.detectVendor("gemini-flash-1.5")).toBe("google");
    });

    it("falls back to openrouter for unknown models", () => {
        expect(AdapterRegistry.detectVendor("mistral-large")).toBe("openrouter");
        expect(AdapterRegistry.detectVendor("llama-3.1-70b")).toBe("openrouter");
    });

    it("registers and retrieves adapters", () => {
        const registry = new AdapterRegistry();
        const adapter = new AnthropicAdapter();
        registry.registerAdapter("anthropic", adapter);
        expect(registry.getAdapter("anthropic")).toBe(adapter);
        expect(registry.listVendors()).toContain("anthropic");
    });

    it("getAdapterForModel routes correctly", () => {
        const registry = new AdapterRegistry();
        registry.registerAdapter("anthropic", new AnthropicAdapter());
        registry.registerAdapter("openai", new OpenAIAdapter());
        const adapter = registry.getAdapterForModel("claude-haiku-4-5-20251001");
        expect(adapter.vendor).toBe("anthropic");
    });

    it("throws for unregistered vendor", () => {
        const registry = new AdapterRegistry();
        expect(() => registry.getAdapter("nonexistent")).toThrow("No adapter registered");
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// Registry Tests
// ══════════════════════════════════════════════════════════════════════════════

describe("MMCPRegistry", () => {
    it("has 4 built-in pipelines", () => {
        const reg = new MMCPRegistry();
        expect(reg.list().length).toBe(4);
    });

    it("search by tags returns correct pipelines", () => {
        const reg = new MMCPRegistry();
        const legal = reg.search({ tags: ["legal"] });
        expect(legal.length).toBe(1);
        expect(legal[0].id).toBe("mmcp://pipelines/legal-review");

        const eng = reg.search({ tags: ["engineering"] });
        expect(eng.length).toBe(2); // code-review + incident-response
    });

    it("search by regulation returns correct pipelines", () => {
        const reg = new MMCPRegistry();
        const gdpr = reg.search({ regulation: "GDPR" });
        expect(gdpr.some(e => e.id === "mmcp://pipelines/legal-review")).toBe(true);
    });

    it("search with has_verify filters correctly", () => {
        const reg = new MMCPRegistry();
        const withVerify = reg.search({ has_verify: true });
        expect(withVerify.length).toBeGreaterThanOrEqual(3);
        const withoutVerify = reg.search({ has_verify: false });
        expect(withoutVerify.length).toBeGreaterThanOrEqual(1);
    });

    it("recordRun updates stats", () => {
        const reg = new MMCPRegistry();
        const id = "mmcp://pipelines/code-review";
        const entry = reg.get(id)!;
        expect(entry.run_count).toBe(0);

        reg.recordRun(id, {
            output: "test",
            dag: [],
            root_id: "r",
            total_nodes: 3,
            total_tokens: 1500,
            duration_ms: 5000,
            success: true,
            failed_nodes: [],
            cost_breakdown: { total_cost_usd: 0.01, by_node: [], by_vendor: {}, by_model: {}, cheapest_node: "", most_expensive_node: "" },
        });

        const updated = reg.get(id)!;
        expect(updated.run_count).toBe(1);
        expect(updated.avg_tokens).toBe(1500);
    });

    it("export → import round-trip preserves entries", () => {
        const reg = new MMCPRegistry();
        const json = reg.export();
        const reg2 = new MMCPRegistry();
        reg2.import(json);
        expect(reg2.list().length).toBe(4);
    });

    it("validate catches missing fields", () => {
        const reg = new MMCPRegistry();
        const result = reg.validate({} as any);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// Compliance Suite Tests
// ══════════════════════════════════════════════════════════════════════════════

describe("MMCPComplianceSuite", () => {
    it("runs all 47 tests and reports results", async () => {
        const suite = new MMCPComplianceSuite();
        const report = await suite.run();

        expect(report.total).toBe(55);
        expect(report.score).toBe(100);
        expect(report.compliant).toBe(true);
        expect(report.failed).toBe(0);

        // Verify all groups exist
        expect(report.groups["Wire Format"]).toBeDefined();
        expect(report.groups["DAG Structure"]).toBeDefined();
        expect(report.groups["Execution"]).toBeDefined();
        expect(report.groups["SharedContext"]).toBeDefined();
        expect(report.groups["Skills"]).toBeDefined();
        expect(report.groups["Adapters"]).toBeDefined();
        expect(report.groups["Compliance"]).toBeDefined();
    });

    it("runGroup returns only targeted group", async () => {
        const suite = new MMCPComplianceSuite();
        const report = await suite.runGroup("Wire Format");
        expect(report.total).toBe(9);
        expect(Object.keys(report.groups)).toEqual(["Wire Format"]);
    });

    it("runTest returns single test result", async () => {
        const suite = new MMCPComplianceSuite();
        const result = await suite.runTest("WF-001");
        expect(result.id).toBe("WF-001");
        expect(result.passed).toBe(true);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// End-to-end Tests (mock adapter — always runs)
// ══════════════════════════════════════════════════════════════════════════════

describe("End-to-end v1.0 pipeline (mock)", () => {
    it("execute returns wire_dag, compliance_report, cost_breakdown", async () => {
        const orc = makeOrc();
        const root = orc.root("Analyze this code for bugs", "architect");
        const forks = fork(root, [{ role: "coder" }, { role: "verifier" }]);
        const merged = merge(forks, { role: "summarizer" });

        const result = await orc.execute([root, ...forks, merged]);

        expect(result.success).toBe(true);
        expect(result.wire_dag).toBeDefined();
        expect(result.wire_dag!.mmcp).toBe("1.0");
        expect(result.wire_dag!.envelopes.length).toBe(4);
        expect(result.compliance_report).toBeDefined();
        expect(result.compliance_report!.valid).toBe(true);
        expect(result.cost_breakdown).toBeDefined();
        expect(result.cost_breakdown!.total_cost_usd).toBeGreaterThanOrEqual(0);
        expect(result.cost_breakdown!.by_node.length).toBe(4);
    });

    it("wire_dag can be re-imported via deserializeDAG", async () => {
        const orc = makeOrc();
        const root = orc.root("Test re-import", "architect");
        const child = handoff(root, { role: "summarizer" });

        const result = await orc.execute([root, child]);
        const wf = new MMCPWireFormat();
        const reimported = wf.deserializeDAG(result.wire_dag!);
        expect(reimported.length).toBe(2);
        expect(reimported[0].task).toBe("Test re-import");
    });

    it("registry is accessible and auto-records if pipeline_id set", async () => {
        const orc = new MMCPOrchestrator({
            router: new RoleBasedRouter({
                architect: { model_id: "claude-haiku-4-5-20251001" },
                summarizer: { model_id: "claude-haiku-4-5-20251001" },
            }),
            store: new MemoryStore(),
            adapter: "mock",
            pipeline_id: "mmcp://pipelines/code-review",
        });

        const root = orc.root("Test registry", "architect");
        const child = handoff(root, { role: "summarizer" });
        await orc.execute([root, child]);

        const entry = orc.registry.get("mmcp://pipelines/code-review")!;
        expect(entry.run_count).toBe(1);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// Real API Integration (skipped without ANTHROPIC_API_KEY)
// ══════════════════════════════════════════════════════════════════════════════

const hasKey = !!process.env.ANTHROPIC_API_KEY;
const describeAPI = hasKey ? describe : describe.skip;

describeAPI("Real API v1.0 end-to-end", () => {
    jest.setTimeout(60000);

    it("executes pipeline and produces valid wire_dag", async () => {
        const orc = new MMCPOrchestrator({
            router: new RoleBasedRouter({
                architect: { model_id: "claude-haiku-4-5-20251001" },
                summarizer: { model_id: "claude-haiku-4-5-20251001" },
            }),
            store: new MemoryStore(),
            adapter: "anthropic",
            regulation_tags: ["SOC2"],
        });

        const root = orc.root("Say hello in exactly 3 words", "architect");
        const child = handoff(root, { role: "summarizer" });
        const result = await orc.execute([root, child]);

        expect(result.success).toBe(true);
        expect(result.wire_dag).toBeDefined();
        expect(result.wire_dag!.mmcp).toBe("1.0");
        expect(result.compliance_report!.valid).toBe(true);
        expect(result.cost_breakdown!.total_cost_usd).toBeGreaterThan(0);
        expect(result.wire_dag!.regulation_tags).toContain("SOC2");
    });
});
