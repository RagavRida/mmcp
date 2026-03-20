import { ContextEnvelope, ModelAssignment, MMCPRouter } from "../core/types";

// ── Role-Based Router ─────────────────────────────────────────────────────────
// Maps semantic role names to model assignments

export interface RoleConfig {
  model_id: string;
  endpoint?: string;
  api_key?: string;
  system_prompt?: string;
  max_tokens?: number;
  temperature?: number;
}

export class RoleBasedRouter implements MMCPRouter {
  private roles: Map<string, RoleConfig>;
  private defaultConfig: RoleConfig;

  constructor(
    roles: Record<string, RoleConfig>,
    defaultConfig?: RoleConfig
  ) {
    this.roles = new Map(Object.entries(roles));
    this.defaultConfig = defaultConfig ?? {
      model_id: "claude-sonnet-4-20250514",
      endpoint: "https://api.anthropic.com/v1/messages",
    };
  }

  route(context: ContextEnvelope): ModelAssignment {
    const config = this.roles.get(context.role) ?? this.defaultConfig;
    return {
      model_id: config.model_id,
      endpoint: config.endpoint ?? "https://api.anthropic.com/v1/messages",
      api_key: config.api_key,
      system_prompt: config.system_prompt ?? this.defaultSystemPrompt(context),
      max_tokens: config.max_tokens ?? 1000,
      temperature: config.temperature ?? 0.7,
    };
  }

  private defaultSystemPrompt(ctx: ContextEnvelope): string {
    return (
      `You are the ${ctx.role.toUpperCase()} agent in an MMCP (Multiple Model Context Protocol) pipeline.\n` +
      `Branch type: ${ctx.branch_type}. Task: ${ctx.task}.\n` +
      `Be concise and stay in your assigned role. Focus only on your specific responsibility.`
    );
  }
}

// ── Confidence-Escalating Router ──────────────────────────────────────────────
// If confidence of prior node < threshold, escalates to a stronger model

export class ConfidenceEscalatingRouter implements MMCPRouter {
  constructor(
    private base: MMCPRouter,
    private strongModel: string,
    private threshold: number = 0.7
  ) {}

  route(context: ContextEnvelope): ModelAssignment {
    const assignment = this.base.route(context);
    // Check if parent confidence is low
    if (
      context.metadata?.parent_confidence != null &&
      (context.metadata.parent_confidence as number) < this.threshold
    ) {
      return { ...assignment, model_id: this.strongModel };
    }
    return assignment;
  }
}

// ── Cost-Optimized Router ─────────────────────────────────────────────────────
// Routes simple roles to cheaper models, complex roles to frontier

export class CostOptimizedRouter implements MMCPRouter {
  private expensiveRoles: Set<string>;

  constructor(
    private frontierModel: string,
    private efficientModel: string,
    expensiveRoles: string[] = ["architect", "reasoner", "synthesizer", "verifier"]
  ) {
    this.expensiveRoles = new Set(expensiveRoles);
  }

  route(context: ContextEnvelope): ModelAssignment {
    const model = this.expensiveRoles.has(context.role)
      ? this.frontierModel
      : this.efficientModel;
    return {
      model_id: model,
      endpoint: "https://api.anthropic.com/v1/messages",
      system_prompt:
        `You are the ${context.role} agent in an MMCP pipeline. Task: ${context.task}. Be concise.`,
      max_tokens: 1000,
    };
  }
}

// ── Scored Router (v2.1 — RL-Ready) ───────────────────────────────────────────
// Routes based on composite scoring with exploration/exploitation trade-off.
// Epsilon-greedy with UCB1 uncertainty bonus for reinforcement learning.

export interface ScoringWeights {
  accuracy: number;   // weight for success rate (0-1)
  latency: number;    // weight for latency penalty (0-1)
  cost: number;       // weight for cost penalty (0-1)
}

interface ModelStats {
  total_runs: number;
  successes: number;
  total_latency_ms: number;
  total_cost_usd: number;
}

export class ScoredRouter implements MMCPRouter {
  private stats = new Map<string, ModelStats>();
  private candidates: string[];
  private weights: ScoringWeights;
  private defaultEndpoint: string;
  private apiKey?: string;

  /** Exploration probability (0 = pure exploit, 1 = pure random). Decays over time. */
  private epsilon: number;
  /** Exploration decay rate per recordOutcome() call. */
  private epsilonDecay: number;
  /** Minimum exploration rate (never goes below). */
  private epsilonMin: number;
  /** UCB1 exploration constant (higher = more exploration of uncertain models). */
  private ucbC: number;
  /** Total model invocations across all models (for UCB1 calculation). */
  private totalInvocations = 0;

  constructor(
    candidates: string[],
    weights: Partial<ScoringWeights> = {},
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

    // Initialize stats for all candidates
    for (const model of candidates) {
      this.stats.set(model, { total_runs: 0, successes: 0, total_latency_ms: 0, total_cost_usd: 0 });
    }
  }

  /** Record the outcome of a model invocation for learning. Also decays epsilon. */
  recordOutcome(model: string, success: boolean, latency_ms: number, cost_usd: number): void {
    let stats = this.stats.get(model);
    if (!stats) {
      stats = { total_runs: 0, successes: 0, total_latency_ms: 0, total_cost_usd: 0 };
      this.stats.set(model, stats);
    }
    stats.total_runs++;
    if (success) stats.successes++;
    stats.total_latency_ms += latency_ms;
    stats.total_cost_usd += cost_usd;
    this.totalInvocations++;

    // Decay exploration rate
    this.epsilon = Math.max(this.epsilonMin, this.epsilon * this.epsilonDecay);
  }

  /** Compute the composite score for a model. Higher = better. */
  computeScore(model: string): number {
    const stats = this.stats.get(model);
    if (!stats || stats.total_runs === 0) return 0.5; // neutral score for unknown models

    const successRate = stats.successes / stats.total_runs;
    const avgLatency = stats.total_latency_ms / stats.total_runs;
    const avgCost = stats.total_cost_usd / stats.total_runs;

    // Normalize latency (assume 10s = 1.0 penalty) and cost (assume $0.01 = 1.0 penalty)
    const latencyNorm = Math.min(avgLatency / 10000, 1);
    const costNorm = Math.min(avgCost / 0.01, 1);

    return (
      this.weights.accuracy * successRate -
      this.weights.latency * latencyNorm -
      this.weights.cost * costNorm
    );
  }

  /** UCB1 uncertainty bonus — encourages exploring models with fewer runs. */
  computeUCB1(model: string): number {
    const stats = this.stats.get(model);
    if (!stats || stats.total_runs === 0) return Infinity; // untried = explore first
    if (this.totalInvocations === 0) return 0;
    return this.ucbC * Math.sqrt(Math.log(this.totalInvocations) / stats.total_runs);
  }

  /** Combined score: base score + UCB1 exploration bonus. */
  computeScoreWithUCB(model: string): number {
    return this.computeScore(model) + this.computeUCB1(model);
  }

  /** Get scores for all candidates, sorted best to worst. */
  getRankings(): Array<{ model: string; score: number; ucb: number; stats: ModelStats }> {
    return this.candidates
      .map(model => ({
        model,
        score: this.computeScore(model),
        ucb: this.computeScoreWithUCB(model),
        stats: this.stats.get(model) ?? { total_runs: 0, successes: 0, total_latency_ms: 0, total_cost_usd: 0 },
      }))
      .sort((a, b) => b.ucb - a.ucb);
  }

  /** Current exploration rate. */
  getEpsilon(): number {
    return this.epsilon;
  }

  route(context: ContextEnvelope): ModelAssignment {
    let chosen: string;
    let reason: string;

    // Epsilon-greedy: explore randomly with probability epsilon
    if (Math.random() < this.epsilon) {
      const idx = Math.floor(Math.random() * this.candidates.length);
      chosen = this.candidates[idx];
      reason = `explore (ε=${this.epsilon.toFixed(3)})`;
    } else {
      // Exploit: pick highest UCB score (score + uncertainty bonus)
      const rankings = this.getRankings();
      chosen = rankings[0].model;
      reason = `exploit (score: ${rankings[0].score.toFixed(3)}, ucb: ${rankings[0].ucb.toFixed(3)})`;
    }

    return {
      model_id: chosen,
      endpoint: this.defaultEndpoint,
      api_key: this.apiKey,
      system_prompt:
        `You are the ${context.role} agent in an MMCP pipeline. Task: ${context.task}. ` +
        `Model selected via RL routing — ${reason}.`,
      max_tokens: 1024,
      temperature: 0.5,
    };
  }
}

