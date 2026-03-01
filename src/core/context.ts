import { v4 as uuidv4 } from "uuid";
import {
  ContextEnvelope, BranchType, ContextStatus, Message,
  MMCP_VERSION, MergeStrategy
} from "./types";

export function createContext(params: {
  task: string;
  role: string;
  model: string;
  parent_ids?: string[];
  branch_type?: BranchType;
  history?: Message[];
  system_prompt?: string;
  depth?: number;
  shard_index?: number;
  merge_strategy?: MergeStrategy;
  max_retries?: number;
  metadata?: Record<string, unknown>;
  required_skills?: string[];
  matched_skills?: string[];
  missing_skills?: string[];
}): ContextEnvelope {
  return {
    mmcp_version: MMCP_VERSION,
    id: `ctx_${uuidv4().replace(/-/g, "").slice(0, 10)}`,
    parent_ids: params.parent_ids ?? [],
    children: [],
    task: params.task,
    history: params.history ?? [],
    system_prompt: params.system_prompt,
    model: params.model,
    role: params.role,
    branch_type: params.branch_type ?? "handoff",
    depth: params.depth ?? 0,
    shard_index: params.shard_index,
    merge_strategy: params.merge_strategy,
    status: "pending",
    retry_count: 0,
    max_retries: params.max_retries ?? 2,
    tokens_used: undefined,
    created_at: new Date().toISOString(),
    metadata: params.metadata ?? {},
    required_skills: params.required_skills,
    matched_skills: params.matched_skills,
    missing_skills: params.missing_skills,
  };
}

// Build the history for a context by collecting parent outputs
export function buildHistory(
  parentContexts: ContextEnvelope[],
  task: string,
  role: string
): Message[] {
  const history: Message[] = [];

  if (parentContexts.length === 1) {
    // Simple handoff: inherit parent history + append output
    const parent = parentContexts[0];
    history.push(...parent.history);
    if (parent.output) {
      history.push({ role: "assistant", content: parent.output });
    }
  } else if (parentContexts.length > 1) {
    // Merge: collect all parent outputs as a structured user message
    const parts = parentContexts
      .filter(p => p.output)
      .map(p => `[${p.role.toUpperCase()}]:\n${p.output}`)
      .join("\n\n---\n\n");

    history.push({
      role: "user",
      content: `You are the ${role}. Multiple agents have completed their tasks. Here are their outputs:\n\n${parts}\n\nTask: ${task}`
    });
  }

  return history;
}

// Topological sort of context DAG
export function topologicalSort(contexts: ContextEnvelope[]): ContextEnvelope[] {
  const map = new Map(contexts.map(c => [c.id, c]));
  const visited = new Set<string>();
  const result: ContextEnvelope[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    const ctx = map.get(id);
    if (!ctx) return;
    // Visit parents first
    for (const pid of ctx.parent_ids) {
      visit(pid);
    }
    visited.add(id);
    result.push(ctx);
  }

  for (const ctx of contexts) {
    visit(ctx.id);
  }

  return result;
}

// Check if all parents of a context are done
export function parentsReady(
  context: ContextEnvelope,
  allContexts: Map<string, ContextEnvelope>
): boolean {
  if (context.parent_ids.length === 0) return true;
  return context.parent_ids.every(pid => {
    const parent = allContexts.get(pid);
    return parent?.status === "done";
  });
}
