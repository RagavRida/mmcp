import { describe, it, expect } from "@jest/globals";
import { MMCPNetworkMesh } from "../src/network/mesh";
import { FeedbackLoop } from "../src/engine/feedback_loop";
import { ContextEngine } from "../src/engine/context_engine";
import { ScoredRouter } from "../src/routing/router";
import { IntentAwareVerifier, BuiltinConstraints } from "../src/operations/verifier";
import { MMCPBenchmarkSuite } from "../src/benchmark/suite";

// ── Network Mesh ────────────────────────────────────────────────────────────

describe("MMCPNetworkMesh", () => {

    it("registers and discovers nodes", () => {
        const mesh = new MMCPNetworkMesh("local_node");

        const india = mesh.registerNode({
            name: "India Agent", region: "ap-south",
            endpoint: "https://india.mmcp.io", capabilities: ["code_generation", "analysis"],
            status: "online", latency_ms: 50, load: 0.3, metadata: {},
        });

        const us = mesh.registerNode({
            name: "US Agent", region: "us-east",
            endpoint: "https://us.mmcp.io", capabilities: ["review", "planning"],
            status: "online", latency_ms: 200, load: 0.1, metadata: {},
        });

        expect(mesh.size).toBe(2);
        expect(mesh.discoverByCapability("code_generation")).toHaveLength(1);
        expect(mesh.discoverByRegion("us-east")).toHaveLength(1);
    });

    it("routes by capability_match strategy", () => {
        const mesh = new MMCPNetworkMesh("local", "capability_match");

        mesh.registerNode({
            name: "Code Node", region: "us-east",
            endpoint: "https://code.mmcp.io", capabilities: ["code_generation"],
            status: "online", latency_ms: 100, load: 0.2, metadata: {},
        });

        mesh.registerNode({
            name: "Review Node", region: "eu-west",
            endpoint: "https://review.mmcp.io", capabilities: ["review", "analysis"],
            status: "online", latency_ms: 150, load: 0.5, metadata: {},
        });

        const decision = mesh.route("code_generation", ["code_generation"]);
        expect(decision).not.toBeNull();
        expect(decision!.target_node.name).toBe("Code Node");
        expect(decision!.reason).toContain("capability match");
    });

    it("routes by nearest strategy", () => {
        const mesh = new MMCPNetworkMesh("local", "nearest");

        mesh.registerNode({
            name: "Far", region: "us-east",
            endpoint: "https://far.mmcp.io", capabilities: ["analysis"],
            status: "online", latency_ms: 500, load: 0.1, metadata: {},
        });

        mesh.registerNode({
            name: "Near", region: "ap-south",
            endpoint: "https://near.mmcp.io", capabilities: ["analysis"],
            status: "online", latency_ms: 20, load: 0.9, metadata: {},
        });

        const decision = mesh.route("analysis");
        expect(decision!.target_node.name).toBe("Near");
    });

    it("routes by least_loaded strategy", () => {
        const mesh = new MMCPNetworkMesh("local", "least_loaded");

        mesh.registerNode({
            name: "Busy", region: "us-east",
            endpoint: "https://busy.mmcp.io", capabilities: ["analysis"],
            status: "online", latency_ms: 20, load: 0.9, metadata: {},
        });

        mesh.registerNode({
            name: "Idle", region: "eu-west",
            endpoint: "https://idle.mmcp.io", capabilities: ["analysis"],
            status: "online", latency_ms: 500, load: 0.05, metadata: {},
        });

        const decision = mesh.route("analysis");
        expect(decision!.target_node.name).toBe("Idle");
    });

    it("creates network messages and tracks stats", () => {
        const mesh = new MMCPNetworkMesh("local_node");
        const node = mesh.registerNode({
            name: "Remote", region: "us-east",
            endpoint: "https://remote.mmcp.io", capabilities: ["code_generation"],
            status: "online", latency_ms: 100, load: 0.2, metadata: {},
        });

        const msg = mesh.createNetworkMessage(node.node_id, "code_generation", "Write hello world");
        expect(msg.sender).toBe("local_node");
        expect(msg.payload.network_hop).toBe(true);

        const stats = mesh.getStats();
        expect(stats.total_messages_routed).toBe(1);
        expect(stats.online_nodes).toBe(1);
    });

    it("handles heartbeat and node removal", () => {
        const mesh = new MMCPNetworkMesh("local");
        const node = mesh.registerNode({
            name: "Test", region: "us-east",
            endpoint: "https://test.io", capabilities: ["analysis"],
            status: "online", latency_ms: 100, load: 0.5, metadata: {},
        });

        mesh.heartbeat(node.node_id, "degraded", 0.8);
        expect(mesh.getNode(node.node_id)!.status).toBe("degraded");

        mesh.removeNode(node.node_id);
        expect(mesh.size).toBe(0);
    });

    it("returns null when no nodes available", () => {
        const mesh = new MMCPNetworkMesh("local");
        expect(mesh.route("code_generation")).toBeNull();
    });
});

// ── Feedback Loop ────────────────────────────────────────────────────────────

describe("FeedbackLoop", () => {

    function createLoop() {
        const ctx = new ContextEngine();
        const router = new ScoredRouter(["model-a", "model-b"], {}, undefined, undefined, { epsilon: 0 });
        const verifier = new IntentAwareVerifier();
        verifier.addConstraint(BuiltinConstraints.minLength(10));
        verifier.addConstraint(BuiltinConstraints.addressesIntent());

        const task = ctx.createTask("session_1", "Test task");
        return { loop: new FeedbackLoop(ctx, router, verifier), taskId: task.task_id, router };
    }

    it("processes feedback: verify → memory → router update", () => {
        const { loop, taskId } = createLoop();

        const entry = loop.processFeedback({
            task_id: taskId,
            model: "model-a",
            intent: "Write a test function",
            output: "Here is a test function that writes unit tests for the project.",
            latency_ms: 1500,
            cost_usd: 0.003,
            tokens_used: 200,
        });

        expect(entry.feedback_id).toMatch(/^fb_/);
        expect(entry.verification.passed).toBe(true);
        expect(entry.router_action).toBe("reward");
        expect(loop.size).toBe(1);
    });

    it("penalizes bad output", () => {
        const { loop, taskId } = createLoop();

        const entry = loop.processFeedback({
            task_id: taskId,
            model: "model-b",
            intent: "Explain quantum physics",
            output: "No.",      // too short, doesn't address intent
            latency_ms: 500,
            cost_usd: 0.001,
            tokens_used: 5,
        });

        expect(entry.verification.passed).toBe(false);
        expect(entry.router_action).toBe("penalize");
    });

    it("tracks improvement metrics over time", () => {
        const { loop, taskId } = createLoop();

        // Simulate 5 good runs
        for (let i = 0; i < 5; i++) {
            loop.processFeedback({
                task_id: taskId,
                model: "model-a",
                intent: "Generate code for processing",
                output: "Here is the code for processing data efficiently with proper error handling.",
                latency_ms: 1000 + i * 100,
                cost_usd: 0.002,
                tokens_used: 150,
            });
        }

        const metrics = loop.getMetrics();
        expect(metrics.total_feedback_entries).toBe(5);
        expect(metrics.avg_confidence_trend.length).toBeGreaterThan(0);
    });

    it("tracks failure patterns", () => {
        const { loop, taskId } = createLoop();

        // 3 failing runs
        for (let i = 0; i < 3; i++) {
            loop.processFeedback({
                task_id: taskId,
                model: "model-b",
                intent: "Explain something complex",
                output: "No.",
                latency_ms: 200,
                cost_usd: 0.001,
                tokens_used: 3,
            });
        }

        const metrics = loop.getMetrics();
        expect(metrics.top_failure_patterns.length).toBeGreaterThan(0);
        expect(metrics.top_failure_patterns[0].count).toBe(3);
    });
});

// ── Benchmark Suite ──────────────────────────────────────────────────────────

describe("MMCPBenchmarkSuite", () => {

    it("adds standard tasks", () => {
        const suite = new MMCPBenchmarkSuite();
        suite.addStandardTasks();
        expect(suite.taskCount).toBe(5);
    });

    it("scores accuracy based on keywords and format", () => {
        const suite = new MMCPBenchmarkSuite();
        suite.addStandardTasks();

        const score = suite.scoreAccuracy(
            {
                id: "t1", description: "Write fibonacci", intent: "code",
                expected_keywords: ["def", "fibonacci", "return"],
                expected_format: "code", difficulty: "easy",
            },
            "def fibonacci(n):\n    if n <= 1: return n\n    return fibonacci(n-1) + fibonacci(n-2)"
        );

        expect(score).toBeGreaterThan(0.8);
    });

    it("generates comparison report", () => {
        const suite = new MMCPBenchmarkSuite();

        // Simulate MMCP run
        suite.recordRun({
            task_id: "t1", system: "mmcp", model: "multi",
            output: "def fibonacci(n): return n if n <= 1 else fibonacci(n-1) + fibonacci(n-2)",
            tokens_used: 200, cost_usd: 0.005, latency_ms: 2000,
            accuracy_score: 0.95, passed: true,
        });

        // Simulate single-model run
        suite.recordRun({
            task_id: "t1", system: "single-model", model: "gpt-4",
            output: "def fib(n): pass",
            tokens_used: 50, cost_usd: 0.002, latency_ms: 1000,
            accuracy_score: 0.4, passed: false,
        });

        const report = suite.generateReport();
        expect(report.total_runs).toBe(2);
        expect(report.winner).toBe("mmcp");
        expect(report.comparisons).toHaveLength(1);
        expect(report.summary["mmcp"].avg_accuracy).toBe(0.95);
    });

    it("handles multiple tasks in report", () => {
        const suite = new MMCPBenchmarkSuite();

        suite.recordRun({ task_id: "t1", system: "mmcp", model: "m", output: "good output here with details", tokens_used: 100, cost_usd: 0.003, latency_ms: 1500, accuracy_score: 0.9, passed: true });
        suite.recordRun({ task_id: "t1", system: "baseline", model: "m", output: "ok", tokens_used: 20, cost_usd: 0.001, latency_ms: 500, accuracy_score: 0.5, passed: true });
        suite.recordRun({ task_id: "t2", system: "mmcp", model: "m", output: "another good result with analysis", tokens_used: 150, cost_usd: 0.004, latency_ms: 2000, accuracy_score: 0.85, passed: true });
        suite.recordRun({ task_id: "t2", system: "baseline", model: "m", output: "meh", tokens_used: 30, cost_usd: 0.001, latency_ms: 800, accuracy_score: 0.3, passed: false });

        const report = suite.generateReport();
        expect(report.total_tasks).toBe(2);
        expect(report.summary["mmcp"].wins).toBe(2);
        expect(report.winner).toBe("mmcp");
    });
});
