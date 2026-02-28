import { ContextEnvelope, ContextStatus, MMCPStore } from "../core/types";

export class MemoryStore implements MMCPStore {
  private store = new Map<string, ContextEnvelope>();

  async save(context: ContextEnvelope): Promise<void> {
    this.store.set(context.id, { ...context });
    // Register this context as a child of each parent
    for (const pid of context.parent_ids) {
      const parent = this.store.get(pid);
      if (parent && !parent.children.includes(context.id)) {
        parent.children.push(context.id);
      }
    }
  }

  async get(id: string): Promise<ContextEnvelope | null> {
    return this.store.get(id) ?? null;
  }

  async getMany(ids: string[]): Promise<ContextEnvelope[]> {
    return ids.map(id => this.store.get(id)).filter(Boolean) as ContextEnvelope[];
  }

  async updateStatus(
    id: string,
    status: ContextStatus,
    output?: string,
    extra?: Partial<ContextEnvelope>
  ): Promise<void> {
    const ctx = this.store.get(id);
    if (!ctx) throw new Error(`Context ${id} not found`);
    Object.assign(ctx, { status, ...extra });
    if (output !== undefined) ctx.output = output;
    if (status === "running") ctx.started_at = new Date().toISOString();
    if (status === "done" || status === "failed") {
      ctx.completed_at = new Date().toISOString();
      if (ctx.started_at) {
        ctx.duration_ms = Date.now() - new Date(ctx.started_at).getTime();
      }
    }
  }

  async getRoots(): Promise<ContextEnvelope[]> {
    return Array.from(this.store.values()).filter(c => c.parent_ids.length === 0);
  }

  async getChildren(id: string): Promise<ContextEnvelope[]> {
    return Array.from(this.store.values()).filter(c => c.parent_ids.includes(id));
  }

  // Dump entire DAG as array (useful for audit)
  dump(): ContextEnvelope[] {
    return Array.from(this.store.values());
  }

  // Pretty-print the DAG for debugging
  printDAG(): void {
    const contexts = this.dump();
    const roots = contexts.filter(c => c.parent_ids.length === 0);

    const STATUS_ICON: Record<string, string> = {
      done: "✓", failed: "✗", running: "⟳", pending: "○", skipped: "–"
    };
    const BRANCH_COLOR: Record<string, string> = {
      root: "\x1b[36m", fork: "\x1b[33m", merge: "\x1b[35m",
      handoff: "\x1b[32m", shard: "\x1b[34m", verify: "\x1b[31m"
    };
    const RESET = "\x1b[0m";

    const print = (ctx: ContextEnvelope, prefix: string, isLast: boolean) => {
      const icon = STATUS_ICON[ctx.status] ?? "?";
      const color = BRANCH_COLOR[ctx.branch_type] ?? "";
      const tokens = ctx.tokens_used ? ` [${ctx.tokens_used}t]` : "";
      const conf = ctx.confidence != null ? ` conf:${ctx.confidence.toFixed(2)}` : "";
      console.log(
        `${prefix}${isLast ? "└─" : "├─"} ${color}[${ctx.branch_type}]${RESET} ` +
        `${icon} ${ctx.role} (${ctx.model.split("-").slice(-2).join("-")})${tokens}${conf}`
      );
      const children = contexts.filter(c => c.parent_ids.includes(ctx.id));
      children.forEach((child, i) => {
        print(child, prefix + (isLast ? "   " : "│  "), i === children.length - 1);
      });
    };

    console.log("\n📊 MMCP Context DAG:");
    roots.forEach((root, i) => print(root, "", i === roots.length - 1));
    console.log();
  }
}
