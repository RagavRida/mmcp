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
