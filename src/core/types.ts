// ─────────────────────────────────────────────────────────────────────────────
// MMCP Core Types  |  Multiple Model Context Protocol v0.1
// ─────────────────────────────────────────────────────────────────────────────

export const MMCP_VERSION = "0.1" as const;

// ── Branch Types ─────────────────────────────────────────────────────────────

export type BranchType =
  | "root"      // Entry point of the DAG
  | "fork"      // 1 → N: spawn parallel sub-contexts
  | "merge"     // N → 1: combine multiple parent outputs
  | "handoff"   // 1 → 1: transfer to different model/role
  | "shard"     // 1 → N: split by content (overflow management)
  | "verify";   // adversarial: producer + challenger → synthesizer

export type ContextStatus =
  | "pending"   // waiting for parent dependencies
  | "running"   // model invocation in progress
  | "done"      // completed successfully
  | "failed"    // exhausted retries
  | "skipped";  // cancelled due to upstream failure

export type MergeStrategy = "union" | "weighted" | "voted";
export type ShardStrategy = "sequential" | "semantic" | "balanced";

// ── Context Envelope ─────────────────────────────────────────────────────────
// The fundamental unit of MMCP. Every model invocation produces one.

export interface ContextEnvelope {
  mmcp_version: typeof MMCP_VERSION;

  // Identity
  id: string;
  parent_ids: string[];          // ARRAY — DAG not tree. Single parents: ['ctx_x']
  children: string[];            // populated as pipeline executes

  // Task
  task: string;                  // human-readable task description
  history: Message[];            // message history passed to model
  system_prompt?: string;        // role-specific system prompt

  // Routing
  model: string;                 // assigned model id
  role: string;                  // semantic role: architect, coder, verifier...
  required_skills?: string[];    // skills this node needs
  matched_skills?: string[];     // skills the assigned model has
  missing_skills?: string[];     // skills required but not matched
  skill_score?: number;          // 0-1 match quality

  // Structure
  branch_type: BranchType;
  depth: number;                 // depth in DAG (root = 0)
  shard_index?: number;          // set for shard branch_type
  merge_strategy?: MergeStrategy;

  // Execution
  status: ContextStatus;
  confidence?: number;           // 0.0 – 1.0
  retry_count: number;
  max_retries: number;

  // Output
  output?: string;

  // Telemetry
  tokens_used?: number;
  created_at: string;            // ISO 8601
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  error?: string;

  // Arbitrary metadata
  metadata: Record<string, unknown>;
}

// ── Message ───────────────────────────────────────────────────────────────────

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// ── Model Assignment ─────────────────────────────────────────────────────────
// Returned by the router for each context node

export interface ModelAssignment {
  model_id: string;
  endpoint: string;
  api_key?: string;
  system_prompt: string;
  max_tokens: number;
  temperature?: number;
}

// ── Router Interface ──────────────────────────────────────────────────────────

export interface MMCPRouter {
  route(context: ContextEnvelope): ModelAssignment;
}

// ── Context Store Interface ───────────────────────────────────────────────────

export interface MMCPStore {
  save(context: ContextEnvelope): Promise<void>;
  get(id: string): Promise<ContextEnvelope | null>;
  getMany(ids: string[]): Promise<ContextEnvelope[]>;
  updateStatus(id: string, status: ContextStatus, output?: string, extra?: Partial<ContextEnvelope>): Promise<void>;
  getRoots(): Promise<ContextEnvelope[]>;
  getChildren(id: string): Promise<ContextEnvelope[]>;
}

// ── MMCP Events ──────────────────────────────────────────────────────────────
// Emitted by orchestrators for observability

export type MMCPEventType =
  | "mmcp.context.created"
  | "mmcp.context.started"
  | "mmcp.context.completed"
  | "mmcp.context.failed"
  | "mmcp.dag.started"
  | "mmcp.dag.completed";

export interface MMCPEvent {
  type: MMCPEventType;
  timestamp: string;
  context_id?: string;
  data: Record<string, unknown>;
}

export type MMCPEventHandler = (event: MMCPEvent) => void;

// ── Pipeline Builder Types ────────────────────────────────────────────────────

export interface NodeSpec {
  role: string;
  model?: string;            // override router
  system_prompt?: string;
  max_retries?: number;
  confidence_threshold?: number;
}

export interface ForkSpec {
  type: "fork";
  nodes: NodeSpec[];
}

export interface MergeSpec {
  type: "merge";
  into: NodeSpec;
  strategy?: MergeStrategy;
}

export interface VerifySpec {
  type: "verify";
  producer: NodeSpec;
  challenger: NodeSpec;
  synthesizer: NodeSpec;
}

export interface ShardSpec {
  type: "shard";
  n: number;
  strategy?: ShardStrategy;
  role: string;
  synthesizer: NodeSpec;
}

export type PipelineStep =
  | ({ type: "node" } & NodeSpec)
  | ForkSpec
  | MergeSpec
  | VerifySpec
  | ShardSpec;

// ── Run Result ────────────────────────────────────────────────────────────────

export interface MMCPRunResult {
  output: string;
  dag: ContextEnvelope[];
  root_id: string;
  total_nodes: number;
  total_tokens: number;
  duration_ms: number;
  success: boolean;
  failed_nodes: string[];
  skill_report?: {
    [ctx_id: string]: {
      required: string[];
      matched: string[];
      missing: string[];
      model_chosen: string;
      reason: string;
    };
  };
}
