import { config } from "dotenv";
config();

import { MMCPOrchestrator, defaultSkillRegistry, forkBySkill, verifyWithSkills } from "../src/index";

// ── Guards ────────────────────────────────────────────────────────────────────

if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌  ANTHROPIC_API_KEY is not set.");
    console.error("    Run:  ANTHROPIC_API_KEY=sk-ant-... npm run example:skills-demo");
    process.exit(1);
}

// ── Main Demo Execution ───────────────────────────────────────────────────────

async function main() {
    console.log("\n🎯  MMCP v0.3 Skill-Aware Routing & Operations Demo\n");

    // ── DEMO 1 — Skill-based routing ──────────────────────────────────────────
    console.log("════════════════════════════════════════════════════════════");
    console.log("  DEMO 1: Skill-based Routing (Model Selection)");
    console.log("════════════════════════════════════════════════════════════\n");

    const task1 = "Review this code for security vulnerabilities:\napp.get('/user/:id', (req, res) => {\n  db.query('SELECT * FROM users WHERE id = ' + req.params.id)\n})";
    console.log(`Task: "${task1}"\n`);

    const demo1Orc = new MMCPOrchestrator({ skillRegistry: defaultSkillRegistry, routingStrategy: "cost_optimized" });

    const node1 = demo1Orc.root(task1, "reviewer");
    node1.required_skills = ["code_review", "security_analysis"];

    const node2 = demo1Orc.root("Summarize the review", "summarizer");
    node2.required_skills = ["summarization"];
    node2.parent_ids = [node1.id];

    const res1 = await demo1Orc.execute([node1, node2]);

    if (res1.skill_report) {
        console.log("Model Selection:");
        console.log(`  node 1 (reviewer): picked ${res1.skill_report[node1.id].model_chosen}`);
        console.log(`  reason: ${res1.skill_report[node1.id].reason}`);
        console.log(`  node 2 (summarizer): picked ${res1.skill_report[node2.id].model_chosen}`);
        console.log(`  reason: ${res1.skill_report[node2.id].reason}\n`);
    }

    console.log(`Total Cost: ${(res1.duration_ms / 1000).toFixed(2)}s, ${res1.total_tokens} tokens\n`);

    // ── DEMO 2 — forkBySkill ──────────────────────────────────────────────────
    console.log("════════════════════════════════════════════════════════════");
    console.log("  DEMO 2: forkBySkill");
    console.log("════════════════════════════════════════════════════════════\n");

    const task2 = "Analyze this startup idea: AI-powered code review SaaS";
    console.log(`Task: "${task2}"\n`);

    const demo2Orc = new MMCPOrchestrator({ skillRegistry: defaultSkillRegistry, routingStrategy: "best_match" });
    const root2 = demo2Orc.root(task2, "manager");

    const forkedNodes = forkBySkill(root2, [
        { required_skills: ["reasoning", "planning"], role: "market_analyst" },
        { required_skills: ["code_review", "reasoning"], role: "tech_analyst" },
        { required_skills: ["summarization"], role: "writer" }
    ], defaultSkillRegistry);

    const [market, tech, writer] = forkedNodes;

    const synthesizer2 = demo2Orc.root("Synthesize the feedback", "synthesizer");
    synthesizer2.required_skills = ["reasoning", "planning"];
    synthesizer2.parent_ids = forkedNodes.map(n => n.id);
    synthesizer2.history = []; // Merge node builds history dynamically
    synthesizer2.branch_type = "merge";
    synthesizer2.depth = 2;

    const res2 = await demo2Orc.execute([root2, ...forkedNodes, synthesizer2]);

    console.log("Forked Node Assignments:");
    console.log(`  market_analyst: ${res2.skill_report?.[market.id]?.model_chosen}`);
    console.log(`  tech_analyst: ${res2.skill_report?.[tech.id]?.model_chosen}`);
    console.log(`  writer: ${res2.skill_report?.[writer.id]?.model_chosen}\n`);

    console.log("DAG:");
    res2.dag.forEach(n => console.log(`  [${n.role}] -> (${n.children.map(c => res2.dag.find(d => d.id === c)?.role ?? c).join(", ") || "none"})`));
    console.log("\nSkill Report:");
    console.log(JSON.stringify(res2.skill_report, null, 2));


    // ── DEMO 3 — verifyWithSkills ────────────────────────────────────────────
    console.log("\n════════════════════════════════════════════════════════════");
    console.log("  DEMO 3: verifyWithSkills (auto model assignment)");
    console.log("════════════════════════════════════════════════════════════\n");

    const task3 = "Is GraphQL always better than REST for mobile apps?";
    console.log(`Task: "${task3}"\n`);

    const demo3Orc = new MMCPOrchestrator({ skillRegistry: defaultSkillRegistry, routingStrategy: "best_match" });
    const producer = demo3Orc.root(task3, "producer");
    producer.required_skills = ["reasoning", "api_design"];

    const [challenger, synthesizer3] = verifyWithSkills(producer, defaultSkillRegistry);

    const res3 = await demo3Orc.execute([producer, challenger, synthesizer3]);

    console.log("Auto-Assigned Models:");
    console.log(`  producer: ${res3.skill_report?.[producer.id]?.model_chosen}`);
    console.log(`  challenger: ${res3.skill_report?.[challenger.id]?.model_chosen}`);
    console.log(`  synthesizer: ${res3.skill_report?.[synthesizer3.id]?.model_chosen}\n`);

    console.log("Producer Output (preview):");
    console.log(`  ${(res3.dag.find(d => d.id === producer.id)?.output ?? "").slice(0, 100)}...\n`);

    console.log("Challenger Output (preview):");
    console.log(`  ${(res3.dag.find(d => d.id === challenger.id)?.output ?? "").slice(0, 100)}...\n`);

    console.log("Final Synthesizer Verdict (preview):");
    console.log(`  ${res3.output.slice(0, 150)}...\n`);

    console.log(`Total Cost Tokens: ${res3.total_tokens}\n`);


    // ── DEMO 4 — Cost optimization proof ──────────────────────────────────────
    console.log("════════════════════════════════════════════════════════════");
    console.log("  DEMO 4: Cost optimization proof (best_match vs cheapest)");
    console.log("════════════════════════════════════════════════════════════\n");

    const task4 = "Explain the history of the CPU briefly.";

    const testOrcBest = new MMCPOrchestrator({ skillRegistry: defaultSkillRegistry, routingStrategy: "best_match" });
    const testOrcCheap = new MMCPOrchestrator({ skillRegistry: defaultSkillRegistry, routingStrategy: "cheapest" });

    const rootA = testOrcBest.root(task4, "historian");
    rootA.required_skills = ["summarization", "reasoning"];

    const rootB = testOrcCheap.root(task4, "historian");
    rootB.required_skills = ["summarization", "reasoning"];

    const [resA, resB] = await Promise.all([
        testOrcBest.execute([rootA]),
        testOrcCheap.execute([rootB])
    ]);

    console.log("Run A (best_match):");
    console.log(`  Model: ${resA.skill_report?.[rootA.id]?.model_chosen}`);
    console.log(`  Tokens: ${resA.total_tokens}, output length: ${resA.output.length} chars\n`);

    console.log("Run B (cheapest):");
    console.log(`  Model: ${resB.skill_report?.[rootB.id]?.model_chosen}`);
    console.log(`  Tokens: ${resB.total_tokens}, output length: ${resB.output.length} chars\n`);

    console.log("Shared Store History (routing decisions via skill_report):");

    // We can see the shared store from any of the local orchestrators
    const hist = testOrcBest.shared.history();
    const routingEvents = hist.filter(e => e.key.startsWith("skill_report"));
    routingEvents.slice(-2).forEach(e => {
        console.log(`  ${e.timestamp} | ${e.key} = ${(e.value as any).model}`);
    });

    console.log("\nSkills Best For ['reasoning', 'code_review']:");
    console.log("  " + JSON.stringify(defaultSkillRegistry.bestModel(["reasoning", "code_review"])));

    console.log("\nSkills Cheapest For ['summarization']:");
    console.log("  " + JSON.stringify(defaultSkillRegistry.cheapestModel(["summarization"])));
}

main().catch(console.error);
