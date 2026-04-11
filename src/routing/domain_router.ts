// ─────────────────────────────────────────────────────────────────────────────
// Domain-Aware Scored Router | MMCP v2.2
//
// Tracks model performance PER DOMAIN, not just overall.
// When models get updated, benchmark results feed into domain-specific
// scores, so routing adapts automatically.
//
// Example: GPT-4o scores 96% on code but 44% on math.
//   - Task "write a parser" → routes to GPT-4o (code domain: 96%)
//   - Task "prove a theorem" → routes to DeepSeek R1 (math domain: 90%)
// ─────────────────────────────────────────────────────────────────────────────

import { ContextEnvelope, ModelAssignment, MMCPRouter } from "../core/types";

// ── Types ───────────────────────────────────────────────────────────────────

export type Domain =
  | "code_generation"
  | "code_review"
  | "math_reasoning"
  | "creative_writing"
  | "analysis"
  | "planning"
  | "summarization"
  | "security"
  | "general";

export interface DomainStats {
  total_runs: number;
  successes: number;
  total_latency_ms: number;
  total_cost_usd: number;
}

export interface DomainScoringWeights {
  accuracy: number;
  latency: number;
  cost: number;
}

/** Keywords that map intents/tasks to domains. */
const DOMAIN_KEYWORDS: Record<Domain, string[]> = {
  code_generation: ["code", "function", "implement", "write", "build", "api", "program", "debug", "fix", "refactor"],
  code_review: ["review", "audit", "inspect", "lint", "quality", "vulnerability", "bug"],
  math_reasoning: ["math", "prove", "theorem", "calculus", "equation", "formula", "calculate", "derivative", "integral"],
  creative_writing: ["write", "blog", "story", "essay", "poem", "creative", "narrative", "article"],
  analysis: ["analyze", "compare", "evaluate", "assess", "pros", "cons", "tradeoff"],
  planning: ["plan", "design", "architect", "strategy", "roadmap", "structure", "system design"],
  summarization: ["summarize", "summary", "condense", "tldr", "brief", "recap"],
  security: ["security", "vulnerability", "exploit", "injection", "auth", "encrypt", "pentest"],
  general: [],
};

// ── Domain-Aware Scored Router ──────────────────────────────────────────────

export class DomainScoredRouter implements MMCPRouter {
  /** Stats keyed by "model::domain" */
  private domainStats = new Map<string, DomainStats>();
  /** Fallback: overall stats per model (for cold-start) */
  private overallStats = new Map<string, DomainStats>();

  private candidates: string[];
  private weights: DomainScoringWeights;
  private defaultEndpoint: string;
  private apiKey?: string;

  private epsilon: number;
  private epsilonDecay: number;
  private epsilonMin: number;
  private ucbC: number;
  private totalInvocations = 0;

  constructor(
    candidates: string[],
    weights: Partial<DomainScoringWeights> = {},
    defaultEndpoint = "https://api.anthropic.com/v1/messages",
    apiKey?: string,
    options: {
      epsilon?: number;
      epsilonDecay?: number;
      epsilonMin?: number;
      ucbC?: number;
    } = {}
  ) {
    this.candidates = candidates;
    this.weights = {
      accuracy: weights.accuracy ?? 0.5,
      latency: weights.latency ?? 0.3,
      cost: weights.cost ?? 0.2,
    };
    this.defaultEndpoint = defaultEndpoint;
    this.apiKey = apiKey;
    this.epsilon = options.epsilon ?? 0.15;
    this.epsilonDecay = options.epsilonDecay ?? 0.995;
    this.epsilonMin = options.epsilonMin ?? 0.01;
    this.ucbC = options.ucbC ?? 1.41;
  }

  // ── Domain Detection ────────────────────────────────────────────────────

  /** Detect the domain from task description and intent. */
  detectDomain(task: string, intent?: string): Domain {
    const text = `${task} ${intent ?? ""}`.toLowerCase();

    let bestDomain: Domain = "general";
    let bestScore = 0;

    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      if (domain === "general") continue;
      const hits = keywords.filter(kw => text.includes(kw)).length;
      if (hits > bestScore) {
        bestScore = hits;
        bestDomain = domain as Domain;
      }
    }

    return bestDomain;
  }

  // ── Outcome Recording ───────────────────────────────────────────────────

  /** Record outcome for a specific domain. This is how the router learns. */
  recordOutcome(
    model: string,
    domain: Domain,
    success: boolean,
    latency_ms: number,
    cost_usd: number
  ): void {
    // Update domain-specific stats
    const key = `${model}::${domain}`;
    let stats = this.domainStats.get(key);
    if (!stats) {
      stats = { total_runs: 0, successes: 0, total_latency_ms: 0, total_cost_usd: 0 };
      this.domainStats.set(key, stats);
    }
    stats.total_runs++;
    if (success) stats.successes++;
    stats.total_latency_ms += latency_ms;
    stats.total_cost_usd += cost_usd;

    // Also update overall stats (fallback for cold-start)
    let overall = this.overallStats.get(model);
    if (!overall) {
      overall = { total_runs: 0, successes: 0, total_latency_ms: 0, total_cost_usd: 0 };
      this.overallStats.set(model, overall);
    }
    overall.total_runs++;
    if (success) overall.successes++;
    overall.total_latency_ms += latency_ms;
    overall.total_cost_usd += cost_usd;

    this.totalInvocations++;
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
  }

  /** Bulk-load from benchmark results. Call this when benchmarks complete. */
  loadBenchmarkResults(
    results: Array<{
      model: string;
      domain: Domain;
      success_rate: number;
      avg_latency_ms: number;
      avg_cost_usd: number;
      sample_size: number;
    }>
  ): void {
    for (const r of results) {
      const key = `${r.model}::${r.domain}`;
      this.domainStats.set(key, {
        total_runs: r.sample_size,
        successes: Math.round(r.success_rate * r.sample_size),
        total_latency_ms: r.avg_latency_ms * r.sample_size,
        total_cost_usd: r.avg_cost_usd * r.sample_size,
      });

      // Update overall too
      const overall = this.overallStats.get(r.model) ?? {
        total_runs: 0, successes: 0, total_latency_ms: 0, total_cost_usd: 0,
      };
      overall.total_runs += r.sample_size;
      overall.successes += Math.round(r.success_rate * r.sample_size);
      overall.total_latency_ms += r.avg_latency_ms * r.sample_size;
      overall.total_cost_usd += r.avg_cost_usd * r.sample_size;
      this.overallStats.set(r.model, overall);
      this.totalInvocations += r.sample_size;
    }
  }

  // ── Scoring ─────────────────────────────────────────────────────────────

  /** Get stats for a model in a specific domain. Falls back to overall. */
  private getStats(model: string, domain: Domain): DomainStats | null {
    // Try domain-specific first
    const domainKey = `${model}::${domain}`;
    const domainSpecific = this.domainStats.get(domainKey);
    if (domainSpecific && domainSpecific.total_runs > 0) return domainSpecific;

    // Fallback to overall
    const overall = this.overallStats.get(model);
    if (overall && overall.total_runs > 0) return overall;

    return null;
  }

  /** Compute score for a model in a specific domain. */
  computeDomainScore(model: string, domain: Domain): number {
    const stats = this.getStats(model, domain);
    if (!stats || stats.total_runs === 0) return 0.5; // neutral for unknown

    const successRate = stats.successes / stats.total_runs;
    const avgLatency = stats.total_latency_ms / stats.total_runs;
    const avgCost = stats.total_cost_usd / stats.total_runs;
    const latencyNorm = Math.min(avgLatency / 10000, 1);
    const costNorm = Math.min(avgCost / 0.01, 1);

    return (
      this.weights.accuracy * successRate -
      this.weights.latency * latencyNorm -
      this.weights.cost * costNorm
    );
  }

  /** UCB1 bonus for a model in a domain. */
  private computeUCB1(model: string, domain: Domain): number {
    const stats = this.getStats(model, domain);
    if (!stats || stats.total_runs === 0) return Infinity;
    if (this.totalInvocations === 0) return 0;
    return this.ucbC * Math.sqrt(Math.log(this.totalInvocations) / stats.total_runs);
  }

  /** Combined score for domain routing. */
  computeScoreWithUCB(model: string, domain: Domain): number {
    return this.computeDomainScore(model, domain) + this.computeUCB1(model, domain);
  }

  /** Get rankings for all candidates in a specific domain. */
  getDomainRankings(domain: Domain): Array<{
    model: string;
    domain: Domain;
    score: number;
    ucb: number;
    stats: DomainStats | null;
  }> {
    return this.candidates
      .map(model => ({
        model,
        domain,
        score: this.computeDomainScore(model, domain),
        ucb: this.computeScoreWithUCB(model, domain),
        stats: this.getStats(model, domain),
      }))
      .sort((a, b) => b.ucb - a.ucb);
  }

  /** Get a model's scores across ALL domains. Shows where it's strong/weak. */
  getModelProfile(model: string): Array<{ domain: Domain; score: number; runs: number }> {
    const domains: Domain[] = [
      "code_generation", "code_review", "math_reasoning", "creative_writing",
      "analysis", "planning", "summarization", "security", "general",
    ];
    return domains.map(domain => {
      const stats = this.getStats(model, domain);
      return {
        domain,
        score: this.computeDomainScore(model, domain),
        runs: stats?.total_runs ?? 0,
      };
    });
  }

  getEpsilon(): number {
    return this.epsilon;
  }

  // ── MMCPRouter interface ────────────────────────────────────────────────

  route(context: ContextEnvelope): ModelAssignment {
    const domain = this.detectDomain(context.task, (context as any).intent);
    let chosen: string;
    let reason: string;

    if (Math.random() < this.epsilon) {
      const idx = Math.floor(Math.random() * this.candidates.length);
      chosen = this.candidates[idx];
      reason = `explore (ε=${this.epsilon.toFixed(3)}, domain=${domain})`;
    } else {
      const rankings = this.getDomainRankings(domain);
      chosen = rankings[0].model;
      reason = `exploit domain=${domain} (score: ${rankings[0].score.toFixed(3)}, ucb: ${rankings[0].ucb.toFixed(3)})`;
    }

    return {
      model_id: chosen,
      endpoint: this.defaultEndpoint,
      api_key: this.apiKey,
      system_prompt:
        `You are the ${context.role} agent in an MMCP pipeline. Task: ${context.task}. ` +
        `Model selected via domain-aware RL routing — ${reason}.`,
      max_tokens: 1024,
      temperature: 0.5,
    };
  }
}
