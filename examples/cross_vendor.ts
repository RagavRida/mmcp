/**
 * MMCP Cross-Vendor Demo
 * ──────────────────────
 * Shows MMCP's per-node model routing across Claude, Gemini, and GPT-4o-mini —
 * all through OpenRouter with a single API key.
 *
 * DAG shape:
 *   root (orchestrator / claude-sonnet-4-5)
 *     ├─ fork → sources    (anthropic/claude-sonnet-4-5)
 *     ├─ fork → history    (google/gemini-2.5-pro-preview-03-25)
 *     └─ fork → economics  (openai/gpt-4o-mini)
 *                └─ merge → synthesizer (anthropic/claude-sonnet-4-5)
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-v1-... ts-node examples/cross_vendor.ts
 */

import {
    MMCPOrchestrator,
    RoleBasedRouter,
    MemoryStore,
    MMCPObserver,
    fork,
    merge,
} from "../src/index";

// ── Config ────────────────────────────────────────────────────────────────────

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const API_KEY = process.env.OPENROUTER_API_KEY;

const TOPIC = "Impact of AI on software engineering jobs in 2025";

// ── Helper: build a role config ───────────────────────────────────────────────

function roleConfig(modelId: string, systemPrompt: string) {
    return {
        model_id: modelId,
        endpoint: ENDPOINT,
        api_key: API_KEY,
        system_prompt: systemPrompt,
        max_tokens: 600,
        temperature: 0.7,
    };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    if (!API_KEY) {
        console.error("❌  Set OPENROUTER_API_KEY before running.");
        process.exit(1);
    }

    // ── Observer: live event stream ──────────────────────────────────────────
    const observer = new MMCPObserver();
    observer.on((e) => {
        const id = e.context_id ? ` [${e.context_id.slice(0, 8)}]` : "";
        const data =
            e.type === "mmcp.context.completed"
                ? `tokens=${e.data.tokens}`
                : e.type === "mmcp.context.started"
                    ? `role=${e.data.role} model=${e.data.model}`
                    : JSON.stringify(e.data);
        console.log(`  ▸ ${e.type}${id}  ${data}`);
    });

    // ── Router: each role mapped to a different vendor ───────────────────────
    const router = new RoleBasedRouter({
        orchestrator: roleConfig(
            "anthropic/claude-sonnet-4-5",
            "You are the ORCHESTRATOR. Given a topic, write a one-sentence framing statement that sets the research agenda for three specialist agents."
        ),
        sources: roleConfig(
            "anthropic/claude-sonnet-4-5",
            "You are the SOURCES agent. Identify 3-4 key primary sources (studies, reports, surveys) that would be essential for understanding this topic. Be specific about org/author names."
        ),
        history: roleConfig(
            "google/gemini-2.5-pro-preview-03-25",
            "You are the HISTORY agent. Provide historical context: how has this topic evolved over 5-10 years? What were the major turning points? Keep it to 3-4 key milestones."
        ),
        economics: roleConfig(
            "openai/gpt-4o-mini",
            "You are the ECONOMICS agent. Analyze the economic dimensions: job market data, salary trends, workforce shifts, and investment flows relevant to this topic."
        ),
        synthesizer: roleConfig(
            "anthropic/claude-sonnet-4-5",
            "You are the SYNTHESIZER. Given inputs from Sources, History, and Economics agents, write a coherent 3-paragraph analysis that weaves all perspectives into a unified view."
        ),
    });

    // ── Orchestrator ──────────────────────────────────────────────────────────
    const orc = new MMCPOrchestrator({
        adapter: "openrouter",
        store: new MemoryStore(),
        observer,
        router,
    });

    // ── Build the DAG manually ────────────────────────────────────────────────
    // root (orchestrator) → fork([sources, history, economics]) → merge(synthesizer)

    const root = orc.root(TOPIC, "orchestrator");

    const branches = fork(root, [
        { role: "sources" },
        { role: "history" },
        { role: "economics" },
    ]);

    const synthesizer = merge(branches, { role: "synthesizer" });

    const dag = [root, ...branches, synthesizer];

    // ── Run ───────────────────────────────────────────────────────────────────
    console.log("\n🔀  MMCP Cross-Vendor Demo");
    console.log(`📋  Topic: ${TOPIC}\n`);
    console.log("─".repeat(64));

    const result = await orc.execute(dag);

    // ── Model routing summary ─────────────────────────────────────────────────
    console.log("\n" + "─".repeat(64));
    console.log(`\n✅  Success:      ${result.success}`);
    console.log(`📊  Nodes:        ${result.total_nodes}`);
    console.log(`🪙  Total tokens: ${result.total_tokens}`);
    console.log(`⏱️   Duration:    ${result.duration_ms}ms\n`);

    console.log("━".repeat(72));
    console.log("  MODEL ROUTING SUMMARY  (showing which model handled each node)");
    console.log("━".repeat(72));
    for (const ctx of result.dag) {
        const status = ctx.status === "done" ? "✓" : "✗";
        const tokens = ctx.tokens_used ?? 0;
        const err = ctx.error ? `  ← ERROR: ${ctx.error}` : "";
        console.log(
            `  ${status}  ${ctx.role.padEnd(14)}  ${ctx.model.padEnd(38)}  ${tokens} tok${err}`
        );
    }
    console.log("━".repeat(72));

    // ── Full outputs per node ────────────────────────────────────────────────
    for (const ctx of result.dag) {
        const header = `${"═".repeat(4)} ${ctx.role.toUpperCase()} [${ctx.model}] ${"═".repeat(4)}`;
        console.log(`\n${header}`);
        if (ctx.status === "failed") {
            console.log(`❌  FAILED: ${ctx.error ?? "unknown error"}`);
        } else {
            console.log(ctx.output ?? "(no output)");
        }
    }
}

main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});
