/**
 * MMCP Shared Context Store Demo
 * ───────────────────────────────
 * Demonstrates cross-node state sharing using SharedContextStore.
 *
 * Pipeline:
 *   architect (sonnet) — sets api_style / auth_method / database in shared store
 *     ├─ fork → frontend_coder (haiku) — reads shared context, writes frontend_complete
 *     └─ fork → backend_coder  (haiku) — reads shared context, writes backend_complete
 *   merge → synthesizer (sonnet) — sees full shared state, writes project_status
 *
 * Adapter:  anthropic (ANTHROPIC_API_KEY from .env / process.env)
 *
 * Usage:
 *   npm run example:shared-context
 */

import {
    MMCPOrchestrator,
    RoleBasedRouter,
    MemoryStore,
    MMCPObserver,
    SharedContextStore,
    fork,
    merge,
} from "../src/index";
import { MemoryStore as MS } from "../src/store/memory";

// ── Guards ────────────────────────────────────────────────────────────────────

if (!process.env.OPENROUTER_API_KEY) {
    console.error("❌  OPENROUTER_API_KEY is not set.");
    console.error("    Run:  OPENROUTER_API_KEY=sk-or-v1-... npm run example:shared-context");
    process.exit(1);
}

// ── Pricing (Anthropic, Feb 2026) ─────────────────────────────────────────────

const PRICING: Record<string, { input: number; output: number }> = {
    "claude-haiku-4-5-20251001": { input: 0.25, output: 1.25 },  // per 1M tokens
    "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
};

function estimateCost(model: string, tokens: number): string {
    const p = PRICING[model];
    if (!p) return "n/a";
    // Rough estimate: 70% input, 30% output
    const cost = ((tokens * 0.7) / 1_000_000) * p.input +
        ((tokens * 0.3) / 1_000_000) * p.output;
    return `$${cost.toFixed(5)}`;
}

// ── Config ────────────────────────────────────────────────────────────────────

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function roleConf(model: string, systemPrompt: string) {
    return {
        model_id: model,
        endpoint: OPENROUTER_ENDPOINT,
        api_key: process.env.OPENROUTER_API_KEY,
        system_prompt: systemPrompt,
        max_tokens: 512,
        temperature: 0.5,
    };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    // ── Shared store ────────────────────────────────────────────────────────────
    const shared = new SharedContextStore();

    // ── Observer: per-node token + cost tracking ────────────────────────────────
    const tokenRows: Array<{ id: string; role: string; model: string; tokens: number }> = [];
    const observer = new MMCPObserver();
    observer.on((e) => {
        const id = e.context_id ? String(e.context_id).slice(0, 8) : "";
        if (e.type === "mmcp.context.started") {
            console.log(`  ▸ started   [${id}]  role=${e.data.role}`);
        } else if (e.type === "mmcp.context.completed") {
            console.log(`  ▸ done      [${id}]  role=${e.data.role}  tokens=${e.data.tokens}`);
        } else if (e.type === "mmcp.context.failed") {
            console.error(`  ✗ FAILED    [${id}]  role=${e.data.role}  error=${e.data.error}`);
        } else if ((e.type as string) === "mmcp.shared.write") {
            console.log(`  📝 shared.write [${id}]  key=${(e.data as any).key}  v${(e.data as any).version}`);
        }
    });

    // ── Store ───────────────────────────────────────────────────────────────────
    const store = new MemoryStore();

    // ── Router ──────────────────────────────────────────────────────────────────
    const router = new RoleBasedRouter({
        architect: roleConf(
            "anthropic/claude-3.5-sonnet",
            "You are the ARCHITECT. Given a project, decide: api_style (REST/GraphQL), auth_method (JWT/OAuth/APIKey), and database (PostgreSQL/MongoDB/SQLite). " +
            "Respond with a brief technical rationale for each choice in 3 bullet points."
        ),
        frontend_coder: roleConf(
            "anthropic/claude-3-haiku",
            "You are the FRONTEND CODER. Write a TypeScript React hook (useApi) that calls the todo API. " +
            "Check SHARED CONTEXT for api_style and auth_method to implement correctly. Keep it under 40 lines."
        ),
        backend_coder: roleConf(
            "anthropic/claude-3-haiku",
            "You are the BACKEND CODER. Write Express.js route handlers for /todos (GET, POST, DELETE). " +
            "Check SHARED CONTEXT for api_style and database to implement correctly. Keep it under 50 lines."
        ),
        synthesizer: roleConf(
            "anthropic/claude-3.5-sonnet",
            "You are the SYNTHESIZER. You have received frontend and backend implementations. " +
            "Write a concise integration guide (3 sections: Setup, API Contract, Auth Flow) based on SHARED CONTEXT and both implementations."
        ),
    });

    // ── Orchestrator ─────────────────────────────────────────────────────────────
    const orc = new MMCPOrchestrator({
        adapter: "openrouter",
        store,
        shared,
        observer,
        router,
        timeoutMs: 120_000,
    });

    // ══════════════════════════════════════════════════════════════════════════
    console.log("\n🔗  MMCP Shared Context Store Demo");
    console.log("📋  Project: REST API for a todo app\n");
    console.log("─".repeat(60));

    // ── STEP 1: Architect ───────────────────────────────────────────────────────
    console.log("\n⬡  Step 1: architect decides stack decisions\n");

    const architectCtx = orc.root(
        "We are building a REST API for a todo app. Decide: api_style, auth_method, and database.",
        "architect"
    );

    const step1 = await orc.execute([architectCtx]);

    // Write architect's decisions to shared store
    const archId = step1.dag[0].id;
    orc.shared.set("api_style", "REST", archId);
    orc.shared.set("auth_method", "JWT", archId);
    orc.shared.set("database", "PostgreSQL", archId);

    // Emit write events for observability
    for (const key of ["api_style", "auth_method", "database"]) {
        const entry = orc.shared.latestEntry(key)!;
        observer.emit("mmcp.shared.write" as any, { key, author_ctx_id: archId, version: entry.version }, archId);
    }

    console.log("\n  📦  Shared store after architect:");
    console.log("     ", JSON.stringify(orc.shared.snapshot(), null, 2).replace(/\n/g, "\n      "));

    // ── STEP 2: Fork → frontend_coder + backend_coder ──────────────────────────
    console.log("\n⬡  Step 2: fork → [frontend_coder, backend_coder] in parallel\n");

    // Re-use same orc but build fresh subDAG with architect as root
    // Fork from the completed architect context
    const [feCtx, beCtx] = fork(step1.dag[0], [
        { role: "frontend_coder" },
        { role: "backend_coder" },
    ]);

    const synthCtx = merge([feCtx, beCtx], { role: "synthesizer" });

    const step2 = await orc.execute([feCtx, beCtx, synthCtx]);

    // Write completion flags from each coder
    const feNode = step2.dag.find(c => c.role === "frontend_coder")!;
    const beNode = step2.dag.find(c => c.role === "backend_coder")!;
    const synNode = step2.dag.find(c => c.role === "synthesizer")!;

    orc.shared.set("frontend_complete", true, feNode.id);
    orc.shared.set("backend_complete", true, beNode.id);

    observer.emit("mmcp.shared.write" as any,
        { key: "frontend_complete", author_ctx_id: feNode.id, version: 1 }, feNode.id);
    observer.emit("mmcp.shared.write" as any,
        { key: "backend_complete", author_ctx_id: beNode.id, version: 1 }, beNode.id);

    // ── STEP 3: Synthesizer writes project_status ───────────────────────────────
    orc.shared.set("project_status", "complete", synNode.id);
    observer.emit("mmcp.shared.write" as any,
        { key: "project_status", author_ctx_id: synNode.id, version: 1 }, synNode.id);

    // ══════════════════════════════════════════════════════════════════════════
    // Merge all DAG nodes for final display
    const allNodes = [...step1.dag, ...step2.dag];
    const totalTokens = allNodes.reduce((s, c) => s + (c.tokens_used ?? 0), 0);

    // ── OUTPUT 1: Node outputs ─────────────────────────────────────────────────
    console.log("\n" + "═".repeat(60));
    console.log("  NODE OUTPUTS (real API responses)");
    console.log("═".repeat(60));
    for (const ctx of allNodes) {
        console.log(`\n  ── ${ctx.role.toUpperCase()} [${ctx.model.split("/").pop()}] ──`);
        console.log(ctx.output?.split("\n").map(l => `  ${l}`).join("\n") ?? "  (no output)");
    }

    // ── OUTPUT 2: DAG visual ───────────────────────────────────────────────────
    console.log("\n" + "═".repeat(60));
    console.log("  DAG STRUCTURE");
    console.log("═".repeat(60));
    (store as MS).printDAG();

    // ── OUTPUT 3: Shared store audit trail ────────────────────────────────────
    console.log("═".repeat(60));
    console.log("  SHARED CONTEXT AUDIT TRAIL");
    console.log("═".repeat(60));
    for (const entry of orc.shared.history()) {
        console.log(
            `  v${entry.version}  [${entry.author_ctx_id.slice(0, 8)}]  ` +
            `${entry.key.padEnd(20)}  ${JSON.stringify(entry.value)}  (${entry.timestamp})`
        );
    }

    // ── OUTPUT 4: Snapshot ────────────────────────────────────────────────────
    console.log("\n" + "═".repeat(60));
    console.log("  FINAL SNAPSHOT (all latest values)");
    console.log("═".repeat(60));
    console.log(JSON.stringify(orc.shared.snapshot(), null, 2)
        .split("\n").map(l => `  ${l}`).join("\n"));

    // ── OUTPUT 5: Cost estimate ───────────────────────────────────────────────
    console.log("\n" + "═".repeat(60));
    console.log("  COST ESTIMATE");
    console.log("═".repeat(60));
    let totalCost = 0;
    for (const ctx of allNodes) {
        const tokens = ctx.tokens_used ?? 0;
        const cost = estimateCost(ctx.model, tokens);
        const cents = parseFloat(cost.slice(1)) || 0;
        totalCost += cents;
        console.log(`  ${ctx.role.padEnd(18)}  ${String(tokens).padStart(5)} tok  ${cost}`);
    }
    console.log("─".repeat(60));
    console.log(`  ${"TOTAL".padEnd(18)}  ${String(totalTokens).padStart(5)} tok  $${totalCost.toFixed(5)}`);
    console.log("═".repeat(60) + "\n");
}

main().catch(err => {
    console.error("\n❌  Fatal:", err.message);
    process.exit(1);
});
