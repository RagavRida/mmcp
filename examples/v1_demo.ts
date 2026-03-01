// ─────────────────────────────────────────────────────────────────────────────
// MMCP v1.0 Demo  —  Production-Ready Pipeline Showcase
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "dotenv";
config();

import {
    MMCPOrchestrator,
    RoleBasedRouter,
    MemoryStore,
    createContext,
    fork,
    merge,
    handoff,
    verify,
    MMCPWireFormat,
    AdapterRegistry,
    AnthropicAdapter,
    MMCPRegistry,
    MMCPComplianceSuite,
} from "../src/index";

const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
const ADAPTER = hasAnthropicKey ? "anthropic" : "openrouter";
const HAIKU = hasAnthropicKey
    ? "claude-haiku-4-5-20251001"
    : "anthropic/claude-3.5-haiku";
const SONNET = hasAnthropicKey
    ? "claude-sonnet-4-20250514"
    : "anthropic/claude-3.5-sonnet";

// ══════════════════════════════════════════════════════════════════════════════
// DEMO 1 — Full v1.0 Pipeline with Compliance Artifact
// ══════════════════════════════════════════════════════════════════════════════

async function demo1() {
    console.log("\n" + "═".repeat(70));
    console.log("DEMO 1 — Full v1.0 Pipeline with Compliance Artifact");
    console.log("═".repeat(70));

    const orc = new MMCPOrchestrator({
        router: new RoleBasedRouter({
            architect: { model_id: SONNET },
            security_analyst: { model_id: SONNET },
            performance_analyst: { model_id: HAIKU },
            verifier: { model_id: SONNET },
            summarizer: { model_id: HAIKU },
        }),
        store: new MemoryStore(),
        adapter: ADAPTER as any,
        regulation_tags: ["SOC2", "GDPR"],
        pipeline_id: "mmcp://pipelines/code-review",
    });

    const codeToReview = `app.post('/login', async (req, res) => {
  const user = await db.query(
    'SELECT * FROM users WHERE email = ' + req.body.email
  )
  if (user && user.password === req.body.password) {
    res.json({ token: jwt.sign(user, 'secret') })
  }
})`;

    const task = `Review this Express.js code for security issues:\n${codeToReview}`;

    // Build pipeline: architect → fork(security, performance) → merge(verifier) → handoff(summarizer)
    const architect = orc.root(task, "architect");
    const forks = fork(architect, [
        { role: "security_analyst" },
        { role: "performance_analyst" },
    ]);
    const verifier = merge(forks, { role: "verifier" });
    const summarizer = handoff(verifier, { role: "summarizer" });

    const result = await orc.execute([architect, ...forks, verifier, summarizer]);

    // 1. Print each node output
    console.log("\n--- Node Outputs ---");
    for (const ctx of result.dag) {
        console.log(`\n[${ctx.role}] (${ctx.model}):`);
        console.log(ctx.output?.slice(0, 200) + (ctx.output && ctx.output.length > 200 ? "..." : ""));
    }

    // 2. Print compliance report
    console.log("\n--- Compliance Report ---");
    const cr = result.compliance_report!;
    console.log(`  Valid: ${cr.valid}`);
    console.log(`  Total nodes: ${cr.total_nodes}`);
    console.log(`  Parallel nodes: ${cr.parallel_nodes}`);
    console.log(`  Merge nodes: ${cr.merge_nodes}`);
    console.log(`  Regulation: ${JSON.stringify(cr.regulation_compliance)}`);

    // 3. Print cost breakdown
    console.log("\n--- Cost Breakdown ---");
    const cb = result.cost_breakdown!;
    console.log(`  Total cost: $${cb.total_cost_usd.toFixed(6)} USD`);
    console.log("  By node:");
    for (const n of cb.by_node) {
        console.log(`    ${n.role} (${n.model}): $${n.cost_usd.toFixed(6)} | in:${n.input_tokens} out:${n.output_tokens}`);
    }
    console.log("  By vendor:", JSON.stringify(cb.by_vendor));
    console.log("  By model:", JSON.stringify(cb.by_model));

    // 4. Print audit chain
    console.log("\n--- Audit Chain ---");
    for (const entry of cr.audit_chain) {
        console.log(`  #${entry.sequence} ${entry.role} (${entry.model}) hash:${entry.audit_hash.slice(0, 12)}... preview:"${entry.output_preview.slice(0, 50)}..."`);
    }

    // 5. Print shared context
    console.log("\n--- Shared Context History ---");
    const history = orc.shared.history();
    console.log(`  ${history.length} entries`);

    return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// DEMO 2 — Cross-Vendor Pipeline Proof
// ══════════════════════════════════════════════════════════════════════════════

async function demo2() {
    console.log("\n" + "═".repeat(70));
    console.log("DEMO 2 — Cross-Vendor Pipeline Proof");
    console.log("═".repeat(70));

    // Shows AdapterRegistry routing by model prefix
    const registry = new AdapterRegistry();
    registry.registerAdapter("anthropic", new AnthropicAdapter());

    const models = [HAIKU, SONNET, "gpt-4o", "gemini-pro-1.5", "mistral-large"];

    console.log("\n  Model → Vendor Routing:");
    console.log("  " + "─".repeat(55));
    for (const model of models) {
        const vendor = AdapterRegistry.detectVendor(model);
        console.log(`  ${model.padEnd(30)} → ${vendor}`);
    }

    // Run a pipeline with two haiku nodes
    const orc = new MMCPOrchestrator({
        router: new RoleBasedRouter({
            analyst: { model_id: HAIKU },
            summarizer: { model_id: HAIKU },
        }),
        store: new MemoryStore(),
        adapter: ADAPTER as any,
    });

    const root = orc.root("What are the three laws of robotics?", "analyst");
    const child = handoff(root, { role: "summarizer" });
    const result = await orc.execute([root, child]);

    console.log("\n  Pipeline Execution:");
    for (const ctx of result.dag) {
        const vendor = AdapterRegistry.detectVendor(ctx.model);
        console.log(`  Node: ${ctx.role.padEnd(15)} Model: ${ctx.model.padEnd(30)} Vendor: ${vendor}`);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// DEMO 3 — Registry in Action
// ══════════════════════════════════════════════════════════════════════════════

async function demo3() {
    console.log("\n" + "═".repeat(70));
    console.log("DEMO 3 — Registry in Action");
    console.log("═".repeat(70));

    const orc = new MMCPOrchestrator({
        router: new RoleBasedRouter({
            architect: { model_id: HAIKU },
            summarizer: { model_id: HAIKU },
        }),
        store: new MemoryStore(),
        adapter: ADAPTER as any,
        pipeline_id: "mmcp://pipelines/code-review",
    });

    // Search for engineering pipelines with verification
    const results = orc.registry.search({ tags: ["engineering"], has_verify: true });
    console.log("\n  Search: { tags: ['engineering'], has_verify: true }");
    for (const entry of results) {
        console.log(`    ${entry.id}`);
        console.log(`      Name: ${entry.name}`);
        console.log(`      Tags: ${entry.tags.join(", ")}`);
        console.log(`      Skills: ${entry.required_skills.join(", ")}`);
        console.log(`      Regulation: ${entry.regulation_tags.join(", ") || "none"}`);
    }

    // Run a pipeline
    const root = orc.root("Check this code for bugs: console.log('hello')", "architect");
    const child = handoff(root, { role: "summarizer" });
    await orc.execute([root, child]);

    // Show updated registry entry
    const entry = orc.registry.get("mmcp://pipelines/code-review")!;
    console.log("\n  Updated Registry Entry:");
    console.log(`    ID: ${entry.id}`);
    console.log(`    Run count: ${entry.run_count}`);
    console.log(`    Avg tokens: ${entry.avg_tokens.toFixed(0)}`);
    console.log(`    Avg cost: $${entry.avg_cost_usd.toFixed(6)}`);
    console.log(`    Last run: ${entry.last_run}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// DEMO 4 — Compliance Suite
// ══════════════════════════════════════════════════════════════════════════════

async function demo4() {
    console.log("\n" + "═".repeat(70));
    console.log("DEMO 4 — Compliance Suite");
    console.log("═".repeat(70));

    const suite = new MMCPComplianceSuite();
    const report = await suite.run();

    console.log(`\n  MMCP v1.0 Compliance Report`);
    console.log("  " + "═".repeat(40));
    console.log(`  Score: ${report.score}% (${report.passed}/${report.total} tests passed)`);

    for (const [groupName, group] of Object.entries(report.groups)) {
        const icon = group.failed === 0 ? "✅" : "❌";
        console.log(`  ${groupName.padEnd(18)} ${icon} ${group.passed}/${group.tests.length}`);
    }

    if (report.failed_tests.length > 0) {
        console.log("\n  Failed tests:");
        for (const t of report.failed_tests) {
            console.log(`    ❌ ${t.id}: ${t.name} — ${t.error}`);
        }
    }

    console.log(`\n  Status: ${report.compliant ? "COMPLIANT ✅" : "NON-COMPLIANT ❌"}`);
    console.log(`  Duration: ${report.duration_ms}ms`);
}

// ══════════════════════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
    console.log("╔══════════════════════════════════════════════════════════════════════╗");
    console.log("║                    MMCP v1.0 — Production Demo                      ║");
    console.log("╚══════════════════════════════════════════════════════════════════════╝");

    const result = await demo1();
    await demo2();
    await demo3();
    await demo4();

    console.log("\n" + "═".repeat(70));
    console.log("MMCP v1.0 Demo Complete");
    console.log("═".repeat(70));
    console.log(`  Total cost this run: $${result.cost_breakdown!.total_cost_usd.toFixed(6)} USD`);
    console.log(`  Full audit chain: ${result.compliance_report!.audit_chain.length} entries`);
    console.log(`  Wire DAG exportable: ✅`);
    console.log(`  Compliance: ${result.compliance_report!.valid ? "COMPLIANT ✅" : "NON-COMPLIANT ❌"}`);
}

main().catch(console.error);
