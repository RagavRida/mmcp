/**
 * MMCP Showcase — All Four Patterns
 * ───────────────────────────────────
 * Demonstrates the four core MMCP design principles in sequence:
 *
 *  1. CONTEXT SPECIALIZATION  — route subtasks to the right model, pass state seamlessly
 *  2. PARALLEL EXECUTION      — fan-out to multiple models, merge back (map-reduce)
 *  3. CONTEXT OVERFLOW        — shard long content across models, maintain meta-context
 *  4. TRUST & VERIFICATION    — producer → challenger → synthesizer pipeline
 *
 * Adapter: "openrouter" (uses OPENROUTER_API_KEY) or fall back to "mock" for offline demo.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-v1-... ts-node examples/showcase.ts        # live
 *   ts-node examples/showcase.ts                                          # mock (no key)
 */

import {
    MMCPOrchestrator,
    RoleBasedRouter,
    MemoryStore,
    MMCPObserver,
} from "../src/index";
import { MemoryStore as MS } from "../src/store/memory";

// ── Detect adapter ────────────────────────────────────────────────────────────

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const ADAPTER = OPENROUTER_KEY ? "openrouter" : "mock";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

console.log(ADAPTER === "openrouter"
    ? "🌐  Running with OpenRouter (live LLM calls)\n"
    : "🧪  No OPENROUTER_API_KEY found — running with mock adapter\n"
);

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Build a role config for OpenRouter */
function rc(model: string, systemPrompt: string) {
    return {
        model_id: model,
        endpoint: ENDPOINT,
        api_key: OPENROUTER_KEY,
        system_prompt: systemPrompt,
        max_tokens: 512,
        temperature: 0.7,
    };
}

/** Make a clean observer that prefixes events with a section label */
function makeObserver(label: string) {
    const obs = new MMCPObserver();
    obs.on((e) => {
        const id = e.context_id ? ` [${String(e.context_id).slice(0, 8)}]` : "";
        const role = (e.data.role as string | undefined) ?? "";
        const tok = e.data.tokens ? `  tokens=${e.data.tokens}` : "";
        if (["mmcp.context.started", "mmcp.context.completed", "mmcp.context.failed"].includes(e.type)) {
            const verb = e.type.replace("mmcp.context.", "");
            console.log(`  [${label}]${id}  ${verb.padEnd(10)}  role=${role}${tok}`);
        }
    });
    return obs;
}

function separator(n = 1) { console.log("\n" + "─".repeat(66) + "\n"); }
function header(n: number, title: string, subtitle: string) {
    console.log(`${"═".repeat(66)}`);
    console.log(`  PATTERN ${n}: ${title}`);
    console.log(`  ${subtitle}`);
    console.log(`${"═".repeat(66)}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN 1 — Context Specialization
// Different models own different skills; context flows through seamlessly.
// Chain: architect → coder → verifier
// ─────────────────────────────────────────────────────────────────────────────

async function pattern1_specialization() {
    header(1,
        "CONTEXT SPECIALIZATION",
        "architect → coder → verifier  (each model owns its skill)"
    );

    const store = new MemoryStore();
    const orc = new MMCPOrchestrator({
        adapter: ADAPTER as "openrouter" | "mock",
        store,
        observer: makeObserver("specialization"),
        router: new RoleBasedRouter({
            architect: rc("anthropic/claude-sonnet-4-5",
                "You are the ARCHITECT. Given a task, produce a concise technical design in 3 bullet points."),
            coder: rc("openai/gpt-4o-mini",
                "You are the CODER. Given an architectural plan, write a minimal but complete code skeleton. Use TypeScript."),
            verifier: rc("google/gemini-2.5-pro-preview-03-25",
                "You are the VERIFIER. Review the code and list any bugs, missing error handling, or security issues."),
        }),
    });

    const result = await orc.runChain(
        "Build a JWT authentication middleware for an Express API",
        ["architect", "coder", "verifier"]
    );

    console.log(`\n  ✅  ${result.total_nodes} nodes | ${result.total_tokens} tokens | ${result.duration_ms}ms`);
    console.log(`\n  Final output (verifier):\n`);
    console.log(result.output.split("\n").map(l => `    ${l}`).join("\n"));
    separator();

    console.log("\n  📊  DAG audit trail:");
    for (const ctx of result.dag) {
        console.log(`    [${ctx.id}]  ${ctx.role.padEnd(12)}  ${ctx.model}  →  ${ctx.tokens_used ?? 0} tok`);
    }

    console.log("\n  🌳  Store visual:");
    (store as MS).printDAG();
}

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN 2 — Parallel Execution (map-reduce for intelligence)
// Fan-out to multiple models simultaneously, merge back.
// root → fork[security, performance, ux] → merge[synthesizer]
// ─────────────────────────────────────────────────────────────────────────────

async function pattern2_parallel() {
    header(2,
        "PARALLEL EXECUTION",
        "root → fork[security, performance, ux] → merge[synthesizer]"
    );

    const store = new MemoryStore();
    const orc = new MMCPOrchestrator({
        adapter: ADAPTER as "openrouter" | "mock",
        store,
        observer: makeObserver("parallel"),
        router: new RoleBasedRouter({
            orchestrator: rc("anthropic/claude-sonnet-4-5",
                "You are the ORCHESTRATOR. Frame this analysis task in one sentence for three specialist agents."),
            security: rc("anthropic/claude-sonnet-4-5",
                "You are the SECURITY analyst. Identify top 3 security concerns for the described system. Be specific."),
            performance: rc("openai/gpt-4o-mini",
                "You are the PERFORMANCE analyst. Identify top 3 performance bottlenecks for the described system."),
            ux: rc("google/gemini-2.5-pro-preview-03-25",
                "You are the UX analyst. Identify top 3 user experience friction points for the described system."),
            synthesizer: rc("anthropic/claude-sonnet-4-5",
                "You are the SYNTHESIZER. Given security, performance, and UX analyses, produce a prioritized action list with 5 items ranked by impact."),
        }),
    });

    const result = await orc.runParallel(
        "A real-time collaborative document editor with offline support (like Google Docs)",
        ["security", "performance", "ux"],
        "synthesizer"
    );

    const forkNodes = result.dag.filter(c => c.branch_type === "fork");
    const mergeNode = result.dag.find(c => c.branch_type === "merge");

    console.log(`\n  ✅  ${result.total_nodes} nodes | ${result.total_tokens} tokens | ${result.duration_ms}ms`);
    console.log(`  🔀  ${forkNodes.length} parallel forks ran simultaneously`);
    console.log(`  🔗  Merge node parent_ids: [${mergeNode?.parent_ids.join(", ")}]\n`);

    console.log("  Synthesized output:\n");
    console.log(result.output.split("\n").map(l => `    ${l}`).join("\n"));
    separator();

    console.log("\n  🌳  Store visual:");
    (store as MS).printDAG();
}

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN 3 — Context Overflow Management
// Shard a long document across N models; a meta-synthesizer holds the whole.
// root → shard[0,1,2][reviewer] → merge[summarizer]
// ─────────────────────────────────────────────────────────────────────────────

async function pattern3_sharding() {
    header(3,
        "CONTEXT OVERFLOW MANAGEMENT",
        "root → shard[0,1,2][analyst] → merge[summarizer]"
    );

    // Simulate a long document that would overflow a single context window
    const LONG_DOCUMENT = `
ANNUAL TECHNOLOGY STRATEGY REPORT — 2025

EXECUTIVE SUMMARY
This report outlines our technology investment strategy for 2025 across three domains:
infrastructure modernization, AI integration, and developer experience. Total planned
investment: $4.2M across 18 months.

SECTION A: INFRASTRUCTURE (Months 1–6)
Our current on-premise infrastructure is reaching end-of-life. Migration to AWS is
planned in three phases. Phase 1 (Q1): data center audit, dependency mapping, and
cloud landing zone setup. Phase 2 (Q2): lift-and-shift of non-critical workloads.
Phase 3 (Q3): re-architecting monolith services into containerized microservices.
Risk: vendor lock-in. Mitigation: multi-cloud abstraction layer using Terraform.
Budget allocation: $1.8M. Expected annual savings post-migration: $400K.

SECTION B: AI INTEGRATION (Months 4–12)
Three AI initiatives are approved: (1) Internal knowledge assistant using RAG over
company documentation, estimated 30% reduction in support ticket volume. (2) Code
review automation using LLM-powered static analysis, targeting 20% faster PR cycles.
(3) Customer-facing recommendation engine for our SaaS product, projected 15% lift
in conversion. Dependencies: data pipeline maturity (B1), privacy review (Legal),
model deployment infrastructure (overlaps with Section A). Budget: $1.6M.

SECTION C: DEVELOPER EXPERIENCE (Months 6–12)
Platform engineering team expansion from 4 to 8 engineers. Deliverables: internal
developer portal, standardized CI/CD templates, local development environment
improvements (Docker Compose parity with staging). Success metric: DORA metrics
improvement — deploy frequency 2x, lead time for changes from 4 days to 1 day.
Budget: $800K. Risk: hiring timeline slippage in competitive market.
  `.trim();

    const store = new MemoryStore();
    const orc = new MMCPOrchestrator({
        adapter: ADAPTER as "openrouter" | "mock",
        store,
        observer: makeObserver("sharding"),
        router: new RoleBasedRouter({
            orchestrator: rc("anthropic/claude-sonnet-4-5",
                "You are the ORCHESTRATOR framing a large document analysis task."),
            analyst: rc("openai/gpt-4o-mini",
                "You are an ANALYST. Summarize the key decisions, risks, and budget figures in this section. Be concise."),
            summarizer: rc("anthropic/claude-sonnet-4-5",
                "You are the SUMMARIZER. Received analysis of 3 sections of a strategy document. Produce an executive summary with: KEY DECISIONS | TOTAL BUDGET | TOP RISKS | RECOMMENDED NEXT STEP"),
        }),
    });

    const result = await orc.runSharded(
        LONG_DOCUMENT,
        "analyst",
        3,
        "summarizer"
    );

    const shardNodes = result.dag.filter(c => c.branch_type === "shard");

    console.log(`\n  ✅  ${result.total_nodes} nodes | ${result.total_tokens} tokens | ${result.duration_ms}ms`);
    console.log(`  📦  ${shardNodes.length} shards processed in parallel`);

    for (const shard of shardNodes) {
        const pct = Math.round(100 / 3);
        const start = shard.shard_index! * pct;
        const end = shard.shard_index! === 2 ? 100 : start + pct;
        console.log(`    shard[${shard.shard_index}]  covers ${start}%-${end}% of document  →  ${shard.tokens_used ?? 0} tok`);
    }

    console.log("\n  Executive summary (from synthesizer):\n");
    console.log(result.output.split("\n").map(l => `    ${l}`).join("\n"));
    separator();

    console.log("\n  🌳  Store visual:");
    (store as MS).printDAG();
}

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN 4 — Trust & Verification
// Producer generates, Challenger audits, Synthesizer arbitrates.
// This is an adversarial contract baked into the protocol.
// producer → [challenger(review) + producer(original)] → synthesizer
// ─────────────────────────────────────────────────────────────────────────────

async function pattern4_verify() {
    header(4,
        "TRUST & VERIFICATION",
        "architect(produces) → challenger(audits) → synthesizer(arbitrates)"
    );

    const store = new MemoryStore();
    const orc = new MMCPOrchestrator({
        adapter: ADAPTER as "openrouter" | "mock",
        store,
        observer: makeObserver("verify"),
        router: new RoleBasedRouter({
            architect: rc("openai/gpt-4o-mini",
                "You are the ARCHITECT. Answer the question confidently and completely."),
            challenger: rc("google/gemini-2.5-pro-preview-03-25",
                "You are the CHALLENGER. Critically review the previous answer. Find factual errors, missing caveats, or oversimplifications. Be specific and cite the flaw."),
            synthesizer: rc("anthropic/claude-sonnet-4-5",
                "You are the SYNTHESIZER. Given an original answer and a critical challenge to it, produce the final, balanced, most accurate answer. Incorporate valid critique, discard unfair challenges."),
        }),
    });

    const result = await orc.runVerify(
        "Is it always better to use async/await over callbacks in Node.js? Explain with examples.",
        "architect",
        "challenger",
        "synthesizer"
    );

    const synthNode = result.dag.find(c => c.role === "synthesizer");

    console.log(`\n  ✅  ${result.total_nodes} nodes | ${result.total_tokens} tokens | ${result.duration_ms}ms`);
    console.log(`  🔗  Synthesizer has ${synthNode?.parent_ids.length} parents (architect + challenger) — this is a DAG merge\n`);

    // Show each stage's contribution
    for (const ctx of result.dag) {
        const label = ctx.role === "architect" ? "📝 PRODUCED" :
            ctx.role === "challenger" ? "🔍 CHALLENGED" : "⚖️  SYNTHESIZED";
        console.log(`  ${label} [${ctx.role}]  ${ctx.tokens_used ?? 0} tok`);
        console.log(ctx.output
            ? (ctx.output.slice(0, 200) + (ctx.output.length > 200 ? "..." : ""))
                .split("\n").slice(0, 4).map(l => `    ${l}`).join("\n")
            : "    (no output)"
        );
        console.log();
    }

    separator();

    console.log("  🌳  Store visual:");
    (store as MS).printDAG();
}

// ─────────────────────────────────────────────────────────────────────────────
// Run all four patterns in sequence
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
    console.log("\n" + "█".repeat(66));
    console.log("  MMCP — MULTIPLE MODEL CONTEXT PROTOCOL");
    console.log("  Four Core Patterns Showcase");
    console.log("█".repeat(66) + "\n");

    await pattern1_specialization();
    await pattern2_parallel();
    await pattern3_sharding();
    await pattern4_verify();

    console.log("█".repeat(66));
    console.log("  All four patterns complete.");
    console.log("█".repeat(66) + "\n");
})().catch((err) => {
    console.error("\n❌  Fatal:", err.message);
    process.exit(1);
});
