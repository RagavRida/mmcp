import { ContextEnvelope, MergeStrategy, ShardStrategy, NodeSpec } from "../core/types";
import { createContext, buildHistory } from "../core/context";

// ── fork ──────────────────────────────────────────────────────────────────────
// 1 → N: spawn N parallel sub-contexts from a single parent

export function fork(
  parent: ContextEnvelope,
  nodes: NodeSpec[]
): ContextEnvelope[] {
  return nodes.map(node =>
    createContext({
      task: parent.task,
      role: node.role,
      model: node.model ?? parent.model,
      parent_ids: [parent.id],
      branch_type: "fork",
      history: buildHistory([parent], parent.task, node.role),
      system_prompt: node.system_prompt,
      depth: parent.depth + 1,
      max_retries: node.max_retries,
    })
  );
}

// ── merge ─────────────────────────────────────────────────────────────────────
// N → 1: combine multiple parent outputs into a single context

export function merge(
  parents: ContextEnvelope[],
  into: NodeSpec,
  strategy: MergeStrategy = "union"
): ContextEnvelope {
  if (parents.length === 0) throw new Error("merge() requires at least one parent");

  const task = parents[0].task;
  const maxDepth = Math.max(...parents.map(p => p.depth));

  return createContext({
    task,
    role: into.role,
    model: into.model ?? parents[0].model,
    parent_ids: parents.map(p => p.id),
    branch_type: "merge",
    history: [],   // intentionally empty — orchestrator builds from parent outputs at runtime
    system_prompt: into.system_prompt,
    depth: maxDepth + 1,
    merge_strategy: strategy,
    max_retries: into.max_retries,
  });
}

// ── handoff ───────────────────────────────────────────────────────────────────
// 1 → 1: pass context to a different model/role

export function handoff(
  parent: ContextEnvelope,
  to: NodeSpec
): ContextEnvelope {
  return createContext({
    task: parent.task,
    role: to.role,
    model: to.model ?? parent.model,
    parent_ids: [parent.id],
    branch_type: "handoff",
    history: buildHistory([parent], parent.task, to.role),
    system_prompt: to.system_prompt,
    depth: parent.depth + 1,
    max_retries: to.max_retries,
  });
}

// ── shard ─────────────────────────────────────────────────────────────────────
// 1 → N: split long content across N parallel shards

export function shard(
  parent: ContextEnvelope,
  n: number,
  role: string,
  strategy: ShardStrategy = "sequential",
  model?: string
): ContextEnvelope[] {
  return Array.from({ length: n }, (_, i) => {
    const shardTask = buildShardTask(parent.task, i, n, strategy);
    return createContext({
      task: shardTask,
      role,
      model: model ?? parent.model,
      parent_ids: [parent.id],
      branch_type: "shard",
      history: [{ role: "user", content: shardTask }],
      depth: parent.depth + 1,
      shard_index: i,
    });
  });
}

function buildShardTask(
  originalTask: string,
  index: number,
  total: number,
  strategy: ShardStrategy
): string {
  const pct = Math.round(100 / total);
  const start = index * pct;
  const end = index === total - 1 ? 100 : start + pct;

  if (strategy === "sequential") {
    return `[SHARD ${index + 1}/${total} — covering ${start}%-${end}% of the content] ${originalTask}`;
  }
  return `[SHARD ${index + 1}/${total}] ${originalTask}`;
}

// ── verify ────────────────────────────────────────────────────────────────────
// Trust contract: producer → challenger + synthesizer
// Returns [challenger, synthesizer] — synthesizer depends on both producer + challenger

export function verify(
  producer: ContextEnvelope,
  challengerSpec: NodeSpec,
  synthesizerSpec: NodeSpec
): [ContextEnvelope, ContextEnvelope] {
  const challenger = createContext({
    task: producer.task,
    role: challengerSpec.role,
    model: challengerSpec.model ?? producer.model,
    parent_ids: [producer.id],
    branch_type: "verify",
    history: buildHistory([producer], producer.task, challengerSpec.role),
    system_prompt:
      challengerSpec.system_prompt ??
      `You are the CHALLENGER in an MMCP verification contract. Your job is to critically review the previous output and identify flaws, edge cases, or incorrect assumptions. Be specific and constructive.`,
    depth: producer.depth + 1,
    metadata: { verify_role: "challenger" },
  });

  // Synthesizer is created as a stub — its parents will be [producer, challenger]
  // but challenger hasn't run yet. The orchestrator resolves this via parent_ids.
  const synthesizer = createContext({
    task: producer.task,
    role: synthesizerSpec.role,
    model: synthesizerSpec.model ?? producer.model,
    parent_ids: [producer.id, challenger.id],
    branch_type: "merge",
    history: [],   // built at runtime from both parents
    system_prompt:
      synthesizerSpec.system_prompt ??
      `You are the SYNTHESIZER in an MMCP verification contract. You have received both the original answer and a critical challenge to it. Produce the final, balanced, correct answer.`,
    depth: producer.depth + 2,
    merge_strategy: "union",
    metadata: { verify_role: "synthesizer" },
  });

  return [challenger, synthesizer];
}
