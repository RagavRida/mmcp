/**
 * MMCP × OpenRouter — live example
 *
 * Runs a verify pipeline (producer → challenger → synthesizer) using any model
 * available on OpenRouter. The API key is read from the OPENROUTER_API_KEY env var.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-v1-... ts-node examples/openrouter.ts
 */

import {
    MMCPOrchestrator,
    RoleBasedRouter,
    MemoryStore,
    MMCPObserver,
} from "../src/index";

// ── Model to use via OpenRouter ───────────────────────────────────────────────
// Any model slug from https://openrouter.ai/models works here.
const MODEL = "google/gemini-2.0-flash-001";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

async function main() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        console.error("❌  Set OPENROUTER_API_KEY before running this example.");
        process.exit(1);
    }

    const observer = new MMCPObserver();
    observer.on((e) => {
        const id = e.context_id ? ` [${e.context_id.slice(0, 8)}]` : "";
        console.log(`  ▸ ${e.type}${id}`, JSON.stringify(e.data));
    });

    const roleConfig = (systemPrompt: string) => ({
        model_id: MODEL,
        endpoint: OPENROUTER_ENDPOINT,
        api_key: apiKey,
        system_prompt: systemPrompt,
        max_tokens: 512,
        temperature: 0.7,
    });

    const orc = new MMCPOrchestrator({
        adapter: "openrouter",
        store: new MemoryStore(),
        observer,
        router: new RoleBasedRouter({
            architect: roleConfig(
                "You are an ARCHITECT agent. Given a task, produce a concise high-level technical plan (3-5 bullet points)."
            ),
            challenger: roleConfig(
                "You are a CHALLENGER agent. Given the architect's plan, identify 2-3 weaknesses or blind-spots — be specific and constructive."
            ),
            synthesizer: roleConfig(
                "You are a SYNTHESIZER agent. Given the original plan and the challenger's critique, produce an improved final plan that addresses the weaknesses."
            ),
        }),
    });

    const task = "Design a scalable real-time chat system for 1 million concurrent users.";

    console.log("\n🚀  MMCP × OpenRouter — Verify Pipeline");
    console.log(`📋  Task: ${task}\n`);
    console.log("─".repeat(60));

    const result = await orc.runVerify(task, "architect", "challenger", "synthesizer");

    console.log("\n" + "─".repeat(60));
    console.log(`\n✅  Success: ${result.success}`);
    console.log(`📊  Nodes: ${result.total_nodes} | Tokens: ${result.total_tokens} | Time: ${result.duration_ms}ms\n`);

    for (const ctx of result.dag) {
        console.log(`\n[${"=".repeat(4)} ${ctx.role.toUpperCase()} | ${ctx.branch_type} ${"=".repeat(4)}]`);
        console.log(ctx.output ?? "(no output)");
    }
}

main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});
