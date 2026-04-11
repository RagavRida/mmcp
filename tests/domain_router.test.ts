import { describe, test, expect } from "@jest/globals";
import { DomainScoredRouter, Domain } from "../src/routing/domain_router";
import { BenchmarkRouterBridge } from "../src/benchmark/bridge";
import { MMCPBenchmarkSuite } from "../src/benchmark/suite";
import { SkillRegistry, defaultSkillRegistry } from "../src/skills/registry";

describe("DomainScoredRouter", () => {
  const models = ["claude-sonnet", "gpt-4o", "deepseek-r1"];

  test("detectDomain identifies code tasks", () => {
    const router = new DomainScoredRouter(models);
    expect(router.detectDomain("Write a Python API with auth")).toBe("code_generation");
    expect(router.detectDomain("Review this code for bugs")).toBe("code_review");
    expect(router.detectDomain("Prove this calculus theorem")).toBe("math_reasoning");
    expect(router.detectDomain("Write a blog post about AI")).toBe("creative_writing");
    expect(router.detectDomain("Summarize this document")).toBe("summarization");
  });

  test("neutral score for unknown models", () => {
    const router = new DomainScoredRouter(models);
    expect(router.computeDomainScore("claude-sonnet", "code_generation")).toBe(0.5);
  });

  test("records domain-specific outcomes", () => {
    const router = new DomainScoredRouter(models);
    // GPT-4o good at code
    for (let i = 0; i < 10; i++) router.recordOutcome("gpt-4o", "code_generation", true, 1000, 0.003);
    // GPT-4o bad at math
    for (let i = 0; i < 10; i++) router.recordOutcome("gpt-4o", "math_reasoning", false, 2000, 0.003);
    // DeepSeek good at math
    for (let i = 0; i < 10; i++) router.recordOutcome("deepseek-r1", "math_reasoning", true, 1500, 0.001);

    const codeScore = router.computeDomainScore("gpt-4o", "code_generation");
    const mathScore = router.computeDomainScore("gpt-4o", "math_reasoning");
    const dsScore = router.computeDomainScore("deepseek-r1", "math_reasoning");

    expect(codeScore).toBeGreaterThan(mathScore);
    expect(dsScore).toBeGreaterThan(mathScore);
  });

  test("domain rankings pick best model per domain", () => {
    const router = new DomainScoredRouter(models, {}, undefined, undefined, { epsilon: 0, ucbC: 0 });
    // Use loadBenchmarkResults for clean, comparable data across all models in all domains
    const domains: Domain[] = ["code_generation", "math_reasoning", "creative_writing"];
    const benchmarks = [];
    for (const m of models) {
      for (const d of domains) {
        benchmarks.push({ model: m, domain: d, success_rate: 0.3, avg_latency_ms: 2000, avg_cost_usd: 0.003, sample_size: 100 });
      }
    }
    // Overwrite specialties
    benchmarks.push({ model: "gpt-4o", domain: "code_generation" as Domain, success_rate: 0.96, avg_latency_ms: 800, avg_cost_usd: 0.003, sample_size: 200 });
    benchmarks.push({ model: "deepseek-r1", domain: "math_reasoning" as Domain, success_rate: 0.92, avg_latency_ms: 1500, avg_cost_usd: 0.001, sample_size: 200 });
    benchmarks.push({ model: "claude-sonnet", domain: "creative_writing" as Domain, success_rate: 0.90, avg_latency_ms: 1200, avg_cost_usd: 0.002, sample_size: 200 });
    router.loadBenchmarkResults(benchmarks);

    const codeRanking = router.getDomainRankings("code_generation");
    const mathRanking = router.getDomainRankings("math_reasoning");
    const writeRanking = router.getDomainRankings("creative_writing");

    expect(codeRanking[0].model).toBe("gpt-4o");
    expect(mathRanking[0].model).toBe("deepseek-r1");
    expect(writeRanking[0].model).toBe("claude-sonnet");
  });

  test("route picks domain-appropriate model", () => {
    const router = new DomainScoredRouter(models, {}, undefined, undefined, { epsilon: 0, ucbC: 0 });
    const benchmarks = [];
    for (const m of models) {
      for (const d of ["code_generation", "math_reasoning"] as Domain[]) {
        benchmarks.push({ model: m, domain: d, success_rate: 0.3, avg_latency_ms: 2000, avg_cost_usd: 0.003, sample_size: 100 });
      }
    }
    benchmarks.push({ model: "gpt-4o", domain: "code_generation" as Domain, success_rate: 0.96, avg_latency_ms: 800, avg_cost_usd: 0.003, sample_size: 200 });
    benchmarks.push({ model: "deepseek-r1", domain: "math_reasoning" as Domain, success_rate: 0.92, avg_latency_ms: 1500, avg_cost_usd: 0.001, sample_size: 200 });
    router.loadBenchmarkResults(benchmarks);

    const codeAssignment = router.route({ task: "Write a Python function", role: "coder", intent: "code_generation" } as any);
    const mathAssignment = router.route({ task: "Prove this theorem", role: "reasoner", intent: "math" } as any);

    expect(codeAssignment.model_id).toBe("gpt-4o");
    expect(mathAssignment.model_id).toBe("deepseek-r1");
  });

  test("loadBenchmarkResults populates domain stats", () => {
    const router = new DomainScoredRouter(models);
    router.loadBenchmarkResults([
      { model: "claude-sonnet", domain: "code_generation", success_rate: 0.95, avg_latency_ms: 1000, avg_cost_usd: 0.002, sample_size: 100 },
      { model: "claude-sonnet", domain: "math_reasoning", success_rate: 0.60, avg_latency_ms: 2000, avg_cost_usd: 0.003, sample_size: 100 },
    ]);

    const codeScore = router.computeDomainScore("claude-sonnet", "code_generation");
    const mathScore = router.computeDomainScore("claude-sonnet", "math_reasoning");
    expect(codeScore).toBeGreaterThan(mathScore);
  });

  test("getModelProfile shows per-domain breakdown", () => {
    const router = new DomainScoredRouter(models);
    router.loadBenchmarkResults([
      { model: "gpt-4o", domain: "code_generation", success_rate: 0.96, avg_latency_ms: 800, avg_cost_usd: 0.003, sample_size: 50 },
      { model: "gpt-4o", domain: "math_reasoning", success_rate: 0.44, avg_latency_ms: 3000, avg_cost_usd: 0.005, sample_size: 50 },
    ]);

    const profile = router.getModelProfile("gpt-4o");
    const codeEntry = profile.find(p => p.domain === "code_generation");
    const mathEntry = profile.find(p => p.domain === "math_reasoning");

    expect(codeEntry!.score).toBeGreaterThan(mathEntry!.score);
    expect(codeEntry!.runs).toBe(50);
  });

  test("epsilon decays on recordOutcome", () => {
    const router = new DomainScoredRouter(models);
    const before = router.getEpsilon();
    router.recordOutcome("gpt-4o", "general", true, 1000, 0.001);
    expect(router.getEpsilon()).toBeLessThan(before);
  });
});

describe("BenchmarkRouterBridge", () => {
  test("refreshSkillRegistry adds skills for high-scoring domains", () => {
    const registry = new SkillRegistry();
    registry.registerSkill({ id: "code_generation", name: "Code Gen", description: "Generate code", category: "coding" });
    registry.registerSkill({ id: "reasoning", name: "Reasoning", description: "Logic", category: "reasoning" });
    registry.registerModel({
      model_id: "test-model",
      skills: [],
      cost_per_1k_input: 0.001,
      cost_per_1k_output: 0.002,
      context_window: 100000,
      strengths: [],
      vendor: "openrouter",
    });

    const router = new DomainScoredRouter(["test-model"]);
    const suite = new MMCPBenchmarkSuite();
    const bridge = new BenchmarkRouterBridge(router, suite, registry);

    bridge.refreshSkillRegistry("test-model", [
      { domain: "code_generation", success_rate: 0.95 },
      { domain: "math_reasoning", success_rate: 0.20 },
    ]);

    const model = registry.getModel("test-model");
    expect(model!.skills).toContain("code_generation");
    expect(model!.skills).not.toContain("reasoning"); // math < 0.3, removed
  });
});
