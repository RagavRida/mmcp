import { ContextEnvelope, MMCPRouter, MMCPStore, MMCPRunResult } from "./core/types";
import { createContext, buildHistory, parentsReady } from "./core/context";
import { MemoryStore } from "./store/memory";
import { AdapterType, getAdapter } from "./core/adapter";
import { MMCPObserver } from "./observability/observer";
import { fork, merge, handoff, shard, verify } from "./operations/index";

export { fork, merge, handoff, shard, verify };
export { createContext, buildHistory } from "./core/context";
export { RoleBasedRouter, ConfidenceEscalatingRouter, CostOptimizedRouter } from "./routing/router";
export { MemoryStore } from "./store/memory";
export { MMCPObserver } from "./observability/observer";
export * from "./core/types";

// ── Orchestrator Config ───────────────────────────────────────────────────────

export interface OrchestratorConfig {
  router: MMCPRouter;
  store?: MMCPStore;
  adapter?: AdapterType;
  observer?: MMCPObserver;
  timeoutMs?: number;
  maxRetries?: number;
  confidenceThreshold?: number;
}

// ── MMCP Orchestrator ─────────────────────────────────────────────────────────

export class MMCPOrchestrator {
  private store: MMCPStore;
  private adapter: ReturnType<typeof getAdapter>;
  private observer: MMCPObserver;

  constructor(private config: OrchestratorConfig) {
    this.store = config.store ?? new MemoryStore();
    this.adapter = getAdapter(config.adapter ?? "anthropic");
    this.observer = config.observer ?? new MMCPObserver();
  }

  // ── Main entry point ──────────────────────────────────────────────────────
  // Execute a pre-built DAG (array of ContextEnvelopes)

  async execute(contexts: ContextEnvelope[]): Promise<MMCPRunResult> {
    const startTime = Date.now();
    const contextMap = new Map<string, ContextEnvelope>();

    // Save all contexts to store
    for (const ctx of contexts) {
      await this.store.save(ctx);
      contextMap.set(ctx.id, ctx);
    }

    const rootIds = contexts.filter(c => c.parent_ids.length === 0).map(c => c.id);
    this.observer.emit("mmcp.dag.started", { root_ids: rootIds, total_nodes: contexts.length });

    const failedNodes: string[] = [];
    const totalTokens = { value: 0 };

    // Execute via parallel-aware topological processing
    await this.executeDAG(contexts, contextMap, failedNodes, totalTokens);

    // Collect leaf outputs
    const leafContexts = contexts.filter(c => c.children.length === 0);
    const leafOutputs = leafContexts
      .filter(c => c.output)
      .map(c => c.output as string);

    const finalOutput =
      leafOutputs.length === 1
        ? leafOutputs[0]
        : leafOutputs.join("\n\n---\n\n");

    const duration = Date.now() - startTime;

    this.observer.emit("mmcp.dag.completed", {
      total_nodes: contexts.length,
      total_tokens: totalTokens.value,
      duration_ms: duration,
      failed: failedNodes.length,
    });

    return {
      output: finalOutput,
      dag: contexts,
      root_id: rootIds[0],
      total_nodes: contexts.length,
      total_tokens: totalTokens.value,
      duration_ms: duration,
      success: failedNodes.length === 0,
      failed_nodes: failedNodes,
    };
  }

  // ── DAG Executor ──────────────────────────────────────────────────────────

  private async executeDAG(
    allContexts: ContextEnvelope[],
    contextMap: Map<string, ContextEnvelope>,
    failedNodes: string[],
    totalTokens: { value: number }
  ): Promise<void> {
    const pending = new Set(allContexts.map(c => c.id));
    const running = new Set<string>();
    const completed = new Set<string>();

    const runNode = async (ctx: ContextEnvelope): Promise<void> => {
      pending.delete(ctx.id);
      running.add(ctx.id);

      // Build history from parents if merge node
      if (ctx.parent_ids.length > 1 && ctx.history.length === 0) {
        const parents = await this.store.getMany(ctx.parent_ids);
        ctx.history = buildHistory(parents, ctx.task, ctx.role);
        await this.store.save(ctx);
      }

      await this.store.updateStatus(ctx.id, "running");
      this.observer.emit("mmcp.context.started", { role: ctx.role, model: ctx.model }, ctx.id);

      try {
        const assignment = this.config.router.route(ctx);

        // Sync model from router → context so result.dag reflects actual model used
        ctx.model = assignment.model_id;

        // Apply timeout
        const timeoutMs = this.config.timeoutMs ?? 60000;
        const result = await Promise.race([
          this.adapter(assignment, ctx),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("MMCP timeout")), timeoutMs)
          ),
        ]);

        totalTokens.value += result.tokens_used;

        await this.store.updateStatus(ctx.id, "done", result.output, {
          tokens_used: result.tokens_used,
          model: result.model,
        });

        ctx.status = "done";
        ctx.output = result.output;
        ctx.tokens_used = result.tokens_used;
        contextMap.set(ctx.id, ctx);

        this.observer.emit("mmcp.context.completed", {
          role: ctx.role,
          tokens: result.tokens_used,
          duration_ms: ctx.duration_ms,
        }, ctx.id);

      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);

        if (ctx.retry_count < ctx.max_retries) {
          ctx.retry_count++;
          await this.store.save(ctx);
          ctx.status = "pending";
          pending.add(ctx.id);
          running.delete(ctx.id);
          return;
        }

        await this.store.updateStatus(ctx.id, "failed", undefined, { error });
        ctx.status = "failed";
        failedNodes.push(ctx.id);

        this.observer.emit("mmcp.context.failed", {
          role: ctx.role,
          error,
          retry_count: ctx.retry_count,
        }, ctx.id);
      }

      running.delete(ctx.id);
      completed.add(ctx.id);
    };

    // Process until all nodes are completed or failed
    while (pending.size > 0 || running.size > 0) {
      // Find all pending nodes whose parents are all completed
      const ready = Array.from(pending)
        .map(id => contextMap.get(id)!)
        .filter(ctx => parentsReady(ctx, contextMap));

      if (ready.length === 0 && running.size === 0) {
        // Deadlock — remaining nodes have unresolvable deps
        for (const id of pending) {
          failedNodes.push(id);
          await this.store.updateStatus(id, "failed", undefined, { error: "Dependency deadlock" });
        }
        break;
      }

      // Dispatch all ready nodes in parallel
      if (ready.length > 0) {
        await Promise.all(ready.map(ctx => runNode(ctx)));
      } else {
        // Wait briefly for running nodes to finish
        await new Promise(r => setTimeout(r, 50));
      }
    }
  }

  // ── Convenience builder methods ───────────────────────────────────────────

  root(task: string, role: string, modelOverride?: string): ContextEnvelope {
    const assignment = this.config.router.route(
      { role, model: modelOverride ?? "" } as ContextEnvelope
    );
    return createContext({
      task,
      role,
      model: modelOverride ?? assignment.model_id,
      parent_ids: [],
      branch_type: "root",
      history: [{ role: "user", content: task }],
      depth: 0,
    });
  }

  // ── High-level pipeline helpers ───────────────────────────────────────────

  // Build a simple linear chain: root → node1 → node2 → ...
  async runChain(
    task: string,
    roles: string[]
  ): Promise<MMCPRunResult> {
    if (roles.length === 0) throw new Error("runChain requires at least one role");

    const contexts: ContextEnvelope[] = [];
    let current = this.root(task, roles[0]);
    contexts.push(current);

    for (let i = 1; i < roles.length; i++) {
      current = handoff(current, { role: roles[i] });
      contexts.push(current);
    }

    return this.execute(contexts);
  }

  // Build a fork → merge pattern
  async runParallel(
    task: string,
    forkRoles: string[],
    mergeRole: string
  ): Promise<MMCPRunResult> {
    const rootCtx = this.root(task, "orchestrator");
    const forks = fork(rootCtx, forkRoles.map(role => ({ role })));
    const mergeCtx = merge(forks, { role: mergeRole });
    return this.execute([rootCtx, ...forks, mergeCtx]);
  }

  // Build a verify pattern: producer → challenger → synthesizer
  async runVerify(
    task: string,
    producerRole: string,
    challengerRole: string,
    synthesizerRole: string
  ): Promise<MMCPRunResult> {
    const producer = this.root(task, producerRole);
    const [challenger, synthesizer] = verify(
      producer,
      { role: challengerRole },
      { role: synthesizerRole }
    );
    return this.execute([producer, challenger, synthesizer]);
  }

  // Build a shard → merge pattern for long content
  async runSharded(
    task: string,
    shardRole: string,
    n: number,
    mergeRole: string
  ): Promise<MMCPRunResult> {
    const rootCtx = this.root(task, "orchestrator");
    const shards = shard(rootCtx, n, shardRole);
    const mergeCtx = merge(shards, { role: mergeRole });
    return this.execute([rootCtx, ...shards, mergeCtx]);
  }
}
