import { config } from "dotenv";
config();

import { SkillRegistry, defaultSkillRegistry } from "../src/skills/registry";
import { SkillAwareRouter, SkillGapDetector } from "../src/routing/skill_router";
import { MMCPOrchestrator } from "../src/index";
import { forkBySkill, verifyWithSkills } from "../src/operations/index";
import { ContextEnvelope } from "../src/core/types";

describe("SkillRegistry", () => {
    let registry: SkillRegistry;

    beforeEach(() => {
        registry = new SkillRegistry();
    });

    it("registerSkill adds skill correctly", () => {
        registry.registerSkill({ id: "test_skill", name: "Test", description: "", category: "reasoning" });
        expect(registry.getSkill("test_skill")).toBeDefined();
        expect(registry.getSkill("test_skill")?.name).toBe("Test");
    });

    it("registerModel adds profile correctly", () => {
        registry.registerModel({
            model_id: "test_model",
            skills: ["test_skill"],
            cost_per_1k_input: 1,
            cost_per_1k_output: 1,
            context_window: 1000,
            strengths: [],
            vendor: "anthropic"
        });
        expect(registry.getModel("test_model")).toBeDefined();
        expect(registry.canHandle("test_model", "test_skill")).toBe(true);
    });

    it("findModels returns sorted by score desc, then cost asc", () => {
        registry.registerModel({ model_id: "cheap_full", skills: ["a", "b"], cost_per_1k_input: 1, cost_per_1k_output: 1, context_window: 1000, strengths: [], vendor: "anthropic" });
        registry.registerModel({ model_id: "expensive_full", skills: ["a", "b"], cost_per_1k_input: 10, cost_per_1k_output: 10, context_window: 1000, strengths: [], vendor: "anthropic" });
        registry.registerModel({ model_id: "partial", skills: ["a"], cost_per_1k_input: 0.1, cost_per_1k_output: 0.1, context_window: 1000, strengths: [], vendor: "anthropic" });

        const matches = registry.findModels(["a", "b"]);
        expect(matches.length).toBe(3);

        // score 1, cost 1
        expect(matches[0].model_id).toBe("cheap_full");
        // score 1, cost 10
        expect(matches[1].model_id).toBe("expensive_full");
        // score 0.5, cost 0.1
        expect(matches[2].model_id).toBe("partial");
    });

    it("bestModel returns highest score model", () => {
        registry.registerModel({ model_id: "partial", skills: ["a"], cost_per_1k_input: 0.1, cost_per_1k_output: 0.1, context_window: 1000, strengths: [], vendor: "anthropic" });
        registry.registerModel({ model_id: "full", skills: ["a", "b"], cost_per_1k_input: 10, cost_per_1k_output: 10, context_window: 1000, strengths: [], vendor: "anthropic" });

        const best = registry.bestModel(["a", "b"]);
        expect(best?.model_id).toBe("full");
    });

    it("cheapestModel returns cheapest with all skills", () => {
        registry.registerModel({ model_id: "cheap_full", skills: ["a", "b"], cost_per_1k_input: 1, cost_per_1k_output: 1, context_window: 1000, strengths: [], vendor: "anthropic" });
        registry.registerModel({ model_id: "expensive_full", skills: ["a", "b"], cost_per_1k_input: 10, cost_per_1k_output: 10, context_window: 1000, strengths: [], vendor: "anthropic" });
        registry.registerModel({ model_id: "super_cheap_partial", skills: ["a"], cost_per_1k_input: 0.1, cost_per_1k_output: 0.1, context_window: 1000, strengths: [], vendor: "anthropic" });

        const cheapest = registry.cheapestModel(["a", "b"]);
        expect(cheapest?.model_id).toBe("cheap_full"); // not super_cheap_partial because it lacks "b"
    });

    it("canHandle returns true/false correctly", () => {
        registry.registerModel({ model_id: "m", skills: ["x"], cost_per_1k_input: 1, cost_per_1k_output: 1, context_window: 1000, strengths: [], vendor: "anthropic" });
        expect(registry.canHandle("m", "x")).toBe(true);
        expect(registry.canHandle("m", "y")).toBe(false);
    });

    it("findModels with unknown skill returns empty or partial matches", () => {
        registry.registerModel({ model_id: "m", skills: ["a"], cost_per_1k_input: 1, cost_per_1k_output: 1, context_window: 1000, strengths: [], vendor: "anthropic" });
        const matches = registry.findModels(["z"]);
        expect(matches[0].score).toBe(0); // partial score 0
        expect(matches[0].matched_skills.length).toBe(0);
    });
});

describe("SkillAwareRouter", () => {
    let registry: SkillRegistry;
    let router: SkillAwareRouter;

    beforeEach(() => {
        registry = new SkillRegistry();
        registry.registerModel({ model_id: "haiku", skills: ["fast"], cost_per_1k_input: 0.25, cost_per_1k_output: 1.25, context_window: 200000, strengths: ["speed"], vendor: "anthropic" });
        registry.registerModel({ model_id: "opus", skills: ["fast", "reasoning", "coding"], cost_per_1k_input: 15, cost_per_1k_output: 75, context_window: 200000, strengths: ["deep analysis"], vendor: "anthropic" });

        router = new SkillAwareRouter(registry, "best_match", "haiku");
    });

    it("routes to correct model based on required_skills", () => {
        const ctx = { required_skills: ["reasoning", "coding"], role: "expert" } as unknown as ContextEnvelope;
        const assignment = router.route(ctx);
        expect(assignment.model_id).toBe("opus");
    });

    it("falls back to role routing when required_skills empty", () => {
        const ctx = { required_skills: [], role: "expert" } as unknown as ContextEnvelope;
        const assignment = router.route(ctx);
        expect(assignment.model_id).toBe("haiku"); // the fallback model
    });

    it("system_prompt includes matched skills and strengths", () => {
        const ctx = { required_skills: ["reasoning"], role: "expert" } as unknown as ContextEnvelope;
        const assignment = router.route(ctx);
        expect(assignment.system_prompt).toContain("reasoning");
        expect(assignment.system_prompt).toContain("deep analysis");
    });

    it("cost_optimized strategy picks haiku for simple skills", () => {
        const costRouter = new SkillAwareRouter(registry, "cost_optimized", "haiku");
        const ctx = { required_skills: ["fast"], role: "helper" } as unknown as ContextEnvelope; // 1 skill (<=2)
        const assignment = costRouter.route(ctx);
        expect(assignment.model_id).toBe("haiku");
    });

    it("cost_optimized strategy picks opus for complex skills", () => {
        const costRouter = new SkillAwareRouter(registry, "cost_optimized", "haiku");
        const ctx = { required_skills: ["fast", "reasoning", "coding"], role: "expert" } as unknown as ContextEnvelope; // 3 skills (>2)
        const assignment = costRouter.route(ctx);
        expect(assignment.model_id).toBe("opus");
    });
});

describe("Skill Gap Detection", () => {
    it("SkillGapDetector warns when skill has no model", () => {
        const gaps = SkillGapDetector.detectGaps({ required_skills: ["magic"] } as unknown as ContextEnvelope, defaultSkillRegistry);
        expect(gaps).toContain("magic");
    });
});

const hasKey = !!process.env.ANTHROPIC_API_KEY;
const describeIntegration = hasKey ? describe : describe.skip;

describeIntegration("Integration (Real API) with Skill Registry", () => {
    // Use a timeout of 30 seconds for real API calls
    jest.setTimeout(30000);

    it("Pipeline with required_skills runs correctly and records skill_report", async () => {
        // We enforce haiku for cost reasons in tests instead of the default models, but we'll use 
        // defaultSkillRegistry models and override them to all map to `claude-haiku-4-5-20251001` or 
        // just rely on them as strings and Anthropic adapter parsing them.
        // Actually, Anthropic Adapter requires valid Anthropic model strings.
        // Currently, defaultSkillRegistry specifies claude-haiku-4-5-20251001 which is valid.

        // Let's create an orchestrator with default registry
        const orc = new MMCPOrchestrator({
            skillRegistry: defaultSkillRegistry,
            routingStrategy: "best_match", // it will pick sonnet or opus if we ask for reasonaing
            // to avoid using sonnet/opus and incurring cost, let's create a custom registry for tests
        });

        const testRegistry = new SkillRegistry();
        testRegistry.registerModel({
            model_id: "claude-haiku-4-5-20251001",
            skills: ["fast_reasoning"],
            cost_per_1k_input: 0.25,
            cost_per_1k_output: 1.25,
            context_window: 200000,
            strengths: ["speed"],
            vendor: "anthropic"
        });

        const testOrc = new MMCPOrchestrator({
            skillRegistry: testRegistry,
            routingStrategy: "best_match"
        });

        const root = testOrc.root("Return exactly 'HELLO SKILLS'", "greeter");
        root.required_skills = ["fast_reasoning"];

        const res = await testOrc.execute([root]);
        if (!res.success) console.error("FAILED NODES:", res.dag.filter(n => n.status === "failed").map(n => String(n.error))); expect(res.success).toBe(true);
        expect(res.output).toContain("HELLO SKILLS");

        // Check skill_report
        expect(res.skill_report).toBeDefined();
        if (res.skill_report) {
            expect(res.skill_report[root.id].model_chosen).toBe("claude-haiku-4-5-20251001");
            expect(res.skill_report[root.id].matched).toContain("fast_reasoning");
        }

        // shared store contains skill_report entries after run
        const hist = testOrc.shared.history();
        const writeEvent = hist.find(e => e.key === `skill_report:${root.id}`);
        expect(writeEvent).toBeDefined();
        expect((writeEvent?.value as any).model).toBe("claude-haiku-4-5-20251001");
    });

    it("forkBySkill creates correct nodes with right models", () => {
        const parent = { id: "p1", task: "Task", depth: 0, model: "haiku", history: [] } as unknown as ContextEnvelope;
        const forked = forkBySkill(parent, [
            { required_skills: ["reasoning"], role: "r_analyst" },
            { required_skills: ["code_generation"], role: "c_analyst" }
        ], defaultSkillRegistry);

        expect(forked.length).toBe(2);
        expect(forked[0].role).toBe("r_analyst");
        // defaultSkillRegistry has sonnet and opus for "reasoning". Both score 1.0, but sonnet is cheaper so it wins!
        expect(forked[0].model).toBe("claude-sonnet-4-20250514");
        expect(forked[0].required_skills).toEqual(["reasoning"]);

        expect(forked[1].role).toBe("c_analyst");
        // haiku actually wins for code_generation because it is cheaper than sonnet ($0.25 vs $3 input cost) and has the skill
        expect(forked[1].model).toBe("claude-haiku-4-5-20251001");
    });

    it("verifyWithSkills auto-assigns correct models", () => {
        const producer = { id: "prod1", task: "Task", depth: 0, model: "haiku", history: [] } as unknown as ContextEnvelope;
        const [challenger, synthesizer] = verifyWithSkills(producer, defaultSkillRegistry);

        expect(challenger.role).toBe("challenger");
        expect(challenger.model).toBe("claude-opus-4-20250514"); // opus has fact_checking, reasoning
        expect(challenger.required_skills).toEqual(["fact_checking", "reasoning"]);

        expect(synthesizer.role).toBe("synthesizer");
        expect(synthesizer.model).toBe("claude-sonnet-4-20250514"); // sonnet has reasoning, summarization
        expect(synthesizer.required_skills).toEqual(["reasoning", "summarization"]);
    });
});
