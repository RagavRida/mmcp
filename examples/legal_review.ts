/**
 * MMCP Sharded Legal Contract Review
 * ────────────────────────────────────
 * Demonstrates MMCP's shard operation for long-document processing.
 *
 * DAG shape:
 *   root (orchestrator)
 *     ├─ shard[0] → reviewer   "reviewing section 1 of 3"
 *     ├─ shard[1] → reviewer   "reviewing section 2 of 3"
 *     └─ shard[2] → reviewer   "reviewing section 3 of 3"
 *                └─ merge → lawyer   (final risk memo)
 *
 * Adapter:   anthropic  (ANTHROPIC_API_KEY from env)
 * Observer:  token usage logged per node (cost tracking)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... ts-node examples/legal_review.ts
 */

import {
    MMCPOrchestrator,
    RoleBasedRouter,
    MemoryStore,
    MMCPObserver,
    MMCPRouter,
    ContextEnvelope,
    ModelAssignment,
} from "../src/index";
import { MemoryStore as MS } from "../src/store/memory";

// ── Contract text (replace with your actual document) ────────────────────────

const CONTRACT_TEXT = `
SOFTWARE SERVICES AGREEMENT

This Software Services Agreement ("Agreement") is entered into as of January 1, 2025,
between Acme Corp ("Client") and DevShop LLC ("Service Provider").

SECTION 1 — SCOPE OF SERVICES
Service Provider agrees to develop and maintain a cloud-based inventory management
system. Deliverables include: backend API, admin dashboard, and mobile application.
Timeline: 6 months from effective date. Service Provider retains full intellectual
property rights to all code, tools, and frameworks developed during the engagement,
including any modifications to existing Client systems. Client receives a non-exclusive,
non-transferable license to use the software while payments remain current.

SECTION 2 — PAYMENT TERMS
Client shall pay a monthly retainer of $15,000 due on the 1st of each month.
Late payments accrue interest at 3% per month compounded daily. Service Provider
may suspend services immediately upon any missed payment without notice. All fees
are non-refundable. Client is responsible for all taxes. Service Provider may
increase fees by up to 25% annually with 7 days notice. Disputed invoices must
be raised within 48 hours of receipt or are deemed accepted.

SECTION 3 — LIABILITY AND INDEMNIFICATION
Service Provider's total liability under this agreement shall not exceed one
month's retainer fee ($15,000) regardless of the nature of the claim, including
data loss, security breaches, or business interruption. Client indemnifies
Service Provider against all third-party claims arising from Client's use of
the software. Service Provider makes no warranties, express or implied,
regarding fitness for purpose, uptime, or data integrity. The Service Provider
is not liable for any system downtime regardless of cause or duration.

SECTION 4 — TERMINATION
Either party may terminate with 90 days written notice. Upon termination by
Client, all outstanding fees become immediately due including fees for the
remainder of the notice period. Service Provider may terminate immediately for
any material breach at its sole discretion. Upon termination, Client's license
is revoked and Client must cease all use of the software within 24 hours.
Data export will be provided at Service Provider's standard rates ($500/hr).
Source code is not provided upon termination under any circumstances.
`.trim();

// ── Custom router with shard-aware system prompts ────────────────────────────
// RoleBasedRouter.route() receives the full ContextEnvelope, so we can
// read ctx.shard_index to inject the section number into the reviewer prompt.

class LegalReviewRouter implements MMCPRouter {
    private readonly ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
    private readonly MODEL = "claude-sonnet-4-5-20250514";
    private readonly API_KEY = process.env.ANTHROPIC_API_KEY;

    route(ctx: ContextEnvelope): ModelAssignment {
        const baseAssignment: ModelAssignment = {
            model_id: this.MODEL,
            endpoint: this.ANTHROPIC_ENDPOINT,
            api_key: this.API_KEY,
            system_prompt: this.systemPrompt(ctx),
            max_tokens: 1024,
            temperature: 0.3,   // lower temp for legal analysis
        };
        return baseAssignment;
    }

    private systemPrompt(ctx: ContextEnvelope): string {
        switch (ctx.role) {
            case "reviewer": {
                // shard_index is 0-based; present it as 1-based to the model
                const section = (ctx.shard_index ?? 0) + 1;
                return (
                    `You are reviewing section ${section} of a legal contract. ` +
                    `List any risks, ambiguous clauses, or missing protections. Be specific. ` +
                    `Format your response as a bulleted list with the clause name and risk type in bold.`
                );
            }
            case "lawyer":
                return (
                    `You received 3 section reviews of a legal contract. ` +
                    `Synthesize into a final risk memo. ` +
                    `Format exactly as:\n\n` +
                    `## CRITICAL RISKS\n[list]\n\n` +
                    `## MODERATE RISKS\n[list]\n\n` +
                    `## RECOMMENDATIONS\n[list]`
                );
            default:
                return `You are the ${ctx.role} agent in an MMCP pipeline. Task: ${ctx.task}. Be concise.`;
        }
    }
}

// ── Token cost tracker ────────────────────────────────────────────────────────

const COST_PER_1K = 0.003;   // ~$3/1M tokens (sonnet pricing, blended)

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error("❌  ANTHROPIC_API_KEY is not set. Export it before running.");
        process.exit(1);
    }

    // ── Observer: log token usage per node (cost tracking) ──────────────────
    const tokenLog: Array<{ role: string; id: string; tokens: number; cost: string }> = [];

    const observer = new MMCPObserver();
    observer.on((e) => {
        if (e.type === "mmcp.dag.started") {
            console.log(`\n  ▸ DAG started  root_ids=${JSON.stringify(e.data.root_ids)}  total_nodes=${e.data.total_nodes}`);
        } else if (e.type === "mmcp.context.started") {
            const section = e.data.role === "reviewer"
                ? `  [shard=${e.data.model}]`
                : "";
            console.log(`  ▸ started  [${String(e.context_id).slice(0, 8)}]  role=${e.data.role}${section}`);
        } else if (e.type === "mmcp.context.completed") {
            const tokens = e.data.tokens as number;
            const cost = ((tokens / 1000) * COST_PER_1K).toFixed(5);
            tokenLog.push({
                role: e.data.role as string,
                id: String(e.context_id).slice(0, 8),
                tokens,
                cost: `$${cost}`,
            });
            console.log(`  ▸ completed [${String(e.context_id).slice(0, 8)}]  role=${e.data.role}  tokens=${tokens}  cost=$${cost}`);
        } else if (e.type === "mmcp.context.failed") {
            console.error(`  ✗ FAILED    [${String(e.context_id).slice(0, 8)}]  role=${e.data.role}  error=${e.data.error}`);
        } else if (e.type === "mmcp.dag.completed") {
            console.log(`  ▸ DAG done   total_tokens=${e.data.total_tokens}  duration=${e.data.duration_ms}ms  failed=${e.data.failed}`);
        }
    });

    // ── Store (typed for printDAG access) ───────────────────────────────────
    const store = new MemoryStore();

    // ── Orchestrator ──────────────────────────────────────────────────────────
    const orc = new MMCPOrchestrator({
        adapter: "anthropic",
        router: new LegalReviewRouter(),
        store,
        observer,
        timeoutMs: 120_000,   // 2 min timeout per node
        maxRetries: 1,
    });

    // ── Run ───────────────────────────────────────────────────────────────────
    console.log("\n⚖️   MMCP Sharded Legal Contract Review");
    console.log(`📄  Contract: ${CONTRACT_TEXT.length} characters, 3 shards\n`);
    console.log("─".repeat(64));

    const result = await orc.runSharded(
        CONTRACT_TEXT,
        "reviewer",   // shard role
        3,            // n shards
        "lawyer"      // synthesizer role
    );

    // ── Results ───────────────────────────────────────────────────────────────
    console.log("\n" + "─".repeat(64));
    console.log(`\n✅  Success:     ${result.success}`);
    console.log(`📊  Nodes:        ${result.total_nodes}`);
    console.log(`⏱️   Duration:    ${result.duration_ms}ms\n`);

    // ── Per-node cost table ──────────────────────────────────────────────────
    const totalTokens = tokenLog.reduce((s, r) => s + r.tokens, 0);
    const totalCost = tokenLog.reduce((s, r) => s + parseFloat(r.cost.slice(1)), 0);

    console.log("━".repeat(60));
    console.log("  COST BREAKDOWN (per node)");
    console.log("━".repeat(60));
    for (const row of tokenLog) {
        console.log(`  ${row.id}  ${row.role.padEnd(12)}  ${String(row.tokens).padStart(6)} tok  ${row.cost}`);
    }
    console.log("━".repeat(60));
    console.log(`  ${"TOTAL".padEnd(22)}  ${String(totalTokens).padStart(6)} tok  $${totalCost.toFixed(5)}`);
    console.log("━".repeat(60));

    // ── result.dag: full audit trail ─────────────────────────────────────────
    console.log("\n\n📋  result.dag (ContextEnvelope audit trail):\n");
    for (const ctx of result.dag) {
        const section = ctx.branch_type === "shard" ? ` (shard ${(ctx.shard_index ?? 0) + 1}/3)` : "";
        console.log(`  • [${ctx.id}]  ${ctx.role.padEnd(10)}  ${ctx.branch_type.padEnd(7)}${section}`);
        console.log(`    status=${ctx.status}  tokens=${ctx.tokens_used ?? 0}  depth=${ctx.depth}`);
        console.log(`    parents=[${ctx.parent_ids.join(", ")}]`);
        if (ctx.output) {
            console.log(`    output: ${ctx.output.slice(0, 120).replace(/\n/g, " ")}...`);
        }
        console.log();
    }

    // ── Final lawyer memo ─────────────────────────────────────────────────────
    console.log("═".repeat(64));
    console.log("  FINAL RISK MEMO  (synthesized by lawyer node)");
    console.log("═".repeat(64));
    console.log(result.output);
    console.log("═".repeat(64));

    // ── Visual DAG tree ───────────────────────────────────────────────────────
    console.log();
    (store as MS).printDAG();
}

main().catch((err) => {
    console.error("\n❌  Fatal error:", err.message);
    if (err.message.includes("API error")) {
        console.error("    Check that ANTHROPIC_API_KEY is valid and has credits.");
    }
    process.exit(1);
});
