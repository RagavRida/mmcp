// ─────────────────────────────────────────────────────────────────────────────
// Benchmark → Router Bridge | MMCP v2.2
//
// Feeds benchmark results into the DomainScoredRouter so routing
// adapts automatically when models get updated.
//
// Usage:
//   const bridge = new BenchmarkRouterBridge(router, suite, registry);
//   await bridge.benchmarkNewModel("gpt-5", adapter);
//   // Router now has domain-specific scores for gpt-5
// ─────────────────────────────────────────────────────────────────────────────

import { DomainScoredRouter, Domain } from "../routing/domain_router";
import { MMCPBenchmarkSuite, BenchmarkTask, BenchmarkRun } from "./suite";
import { SkillRegistry, ModelSkillProfile } from "../skills/registry";

// Map benchmark intents to router domains
const INTENT_TO_DOMAIN: Record<string, Domain> = {
  code_generation: "code_generation",
  review: "code_review",
  analysis: "analysis",
  planning: "planning",
  synthesis: "summarization",
  summarization: "summarization",
  math: "math_reasoning",
  reasoning: "math_reasoning",
  creative: "creative_writing",
  security: "security",
};

export interface BenchmarkAdapterFn {
  (task: string, model: string): Promise<{
    output: string;
    tokens_used: number;
    cost_usd: number;
    latency_ms: number;
  }>;
}

export class BenchmarkRouterBridge {
  constructor(
    private router: DomainScoredRouter,
    private suite: MMCPBenchmarkSuite,
    private registry?: SkillRegistry
  ) {}

  /**
   * Run benchmark tasks against a model and feed results into the router.
   * Call this when a new model is added or an existing model is updated.
   */
  async benchmarkModel(
    model: string,
    adapter: BenchmarkAdapterFn,
    tasks?: BenchmarkTask[]
  ): Promise<{
    model: string;
    results: Array<{ domain: Domain; success_rate: number; avg_latency_ms: number }>;
  }> {
    const benchTasks = tasks ?? this.getStandardTasks();
    const domainResults = new Map<Domain, { successes: number; total: number; latency: number; cost: number }>();

    for (const task of benchTasks) {
      const domain = INTENT_TO_DOMAIN[task.intent] ?? "general";

      try {
        const result = await adapter(task.description, model);
        const accuracy = this.suite.scoreAccuracy(task, result.output);
        const passed = accuracy >= 0.5;

        // Record in benchmark suite
        this.suite.recordRun({
          task_id: task.id,
          system: model,
          model,
          output: result.output,
          tokens_used: result.tokens_used,
          cost_usd: result.cost_usd,
          latency_ms: result.latency_ms,
          accuracy_score: accuracy,
          passed,
        });

        // Record in router (domain-aware)
        this.router.recordOutcome(model, domain, passed, result.latency_ms, result.cost_usd);

        // Accumulate for summary
        const acc = domainResults.get(domain) ?? { successes: 0, total: 0, latency: 0, cost: 0 };
        acc.total++;
        if (passed) acc.successes++;
        acc.latency += result.latency_ms;
        acc.cost += result.cost_usd;
        domainResults.set(domain, acc);

      } catch (e) {
        // Failed run — record as failure
        const domain_d = INTENT_TO_DOMAIN[task.intent] ?? "general";
        this.router.recordOutcome(model, domain_d, false, 30000, 0);
      }
    }

    // Build summary
    const results: Array<{ domain: Domain; success_rate: number; avg_latency_ms: number }> = [];
    for (const [domain, acc] of domainResults) {
      results.push({
        domain,
        success_rate: acc.total > 0 ? acc.successes / acc.total : 0,
        avg_latency_ms: acc.total > 0 ? acc.latency / acc.total : 0,
      });
    }

    return { model, results };
  }

  /**
   * Update the SkillRegistry based on benchmark results.
   * If a model scores >70% in a domain, add that domain's skills.
   * If it scores <30%, remove them.
   */
  refreshSkillRegistry(
    model: string,
    benchmarkResults: Array<{ domain: Domain; success_rate: number }>
  ): void {
    if (!this.registry) return;

    const existing = this.registry.getModel(model);
    if (!existing) return;

    const domainToSkills: Record<string, string[]> = {
      code_generation: ["code_generation", "code_execution"],
      code_review: ["code_review", "security_analysis"],
      math_reasoning: ["reasoning"],
      analysis: ["reasoning", "fact_checking"],
      planning: ["planning", "api_design"],
      summarization: ["summarization"],
      creative_writing: ["summarization", "long_context"],
      security: ["security_analysis"],
    };

    const currentSkills = new Set(existing.skills);

    for (const { domain, success_rate } of benchmarkResults) {
      const skills = domainToSkills[domain] ?? [];
      for (const skill of skills) {
        if (success_rate >= 0.7) {
          currentSkills.add(skill);
        } else if (success_rate < 0.3) {
          currentSkills.delete(skill);
        }
      }
    }

    // Re-register with updated skills
    const updated: ModelSkillProfile = {
      ...existing,
      skills: Array.from(currentSkills),
    };
    this.registry.registerModel(updated);
  }

  /**
   * Full pipeline: benchmark a model, update router, update skill registry.
   * Call this when a model provider announces an update.
   */
  async onModelUpdated(
    model: string,
    adapter: BenchmarkAdapterFn
  ): Promise<void> {
    const { results } = await this.benchmarkModel(model, adapter);
    this.refreshSkillRegistry(model, results);
  }

  private getStandardTasks(): BenchmarkTask[] {
    // Use suite's standard tasks if available, or create defaults
    this.suite.addStandardTasks();
    return [
      { id: "domain_code", description: "Write a Python function to find the nth Fibonacci number", intent: "code_generation", expected_keywords: ["def", "fibonacci", "return"], expected_format: "code", difficulty: "easy" },
      { id: "domain_math", description: "Prove that the sum of first n natural numbers is n(n+1)/2", intent: "math", expected_keywords: ["induction", "base", "step", "prove"], expected_format: "text", difficulty: "medium" },
      { id: "domain_review", description: "Review this code for security: eval(user_input)", intent: "review", expected_keywords: ["security", "eval", "injection"], expected_format: "text", difficulty: "easy" },
      { id: "domain_creative", description: "Write a short story about a robot learning to paint", intent: "creative", expected_keywords: ["robot", "paint", "color"], expected_format: "text", difficulty: "easy" },
      { id: "domain_analysis", description: "Analyze pros and cons of microservices vs monolith", intent: "analysis", expected_keywords: ["microservices", "monolith", "scaling"], expected_format: "text", difficulty: "medium" },
      { id: "domain_plan", description: "Design a REST API for a task management system", intent: "planning", expected_keywords: ["endpoint", "authentication", "CRUD"], expected_format: "text", difficulty: "hard" },
      { id: "domain_summary", description: "Summarize: AI is transforming healthcare through diagnostics, drug discovery, and patient monitoring", intent: "summarization", expected_keywords: ["AI", "healthcare"], expected_format: "text", difficulty: "easy" },
      { id: "domain_security", description: "Find vulnerabilities in: SELECT * FROM users WHERE id = '" + "' + userId + '", intent: "security", expected_keywords: ["SQL", "injection", "parameterize"], expected_format: "text", difficulty: "easy" },
    ];
  }
}
