import { describe, test, expect } from "@jest/globals";
import { SkillCoordinator } from "../src/coordination/skill_coordinator";
import { SkillRegistry, defaultSkillRegistry } from "../src/skills/registry";

const ok = async () => ({ accepted: true, agent_id: "", response: "done" });

describe("SkillCoordinator", () => {
  test("register agents with skills", () => {
    const sc = new SkillCoordinator();
    sc.register({ name: "Coder", skills: ["code_generation", "debugging"], handler: ok });
    sc.register({ name: "Writer", skills: ["writing", "editing"], handler: ok });

    const agents = sc.getCoordinator().listAgents();
    expect(agents.length).toBe(2);
    expect(agents[0].capabilities).toContain("code_generation");
  });

  test("handoffBySkill finds the right agent", async () => {
    const sc = new SkillCoordinator();
    const coder = sc.register({ name: "Coder", skills: ["code_generation"], handler: async (h) => ({ accepted: true, agent_id: h.to_agent, response: "coded" }) });
    sc.register({ name: "Writer", skills: ["writing"], handler: async (h) => ({ accepted: true, agent_id: h.to_agent, response: "wrote" }) });

    const result = await sc.handoffBySkill("external", "c1", [{ role: "user", content: "write code" }], ["code_generation"], "need code");
    expect(result.accepted).toBe(true);
    expect(result.response).toBe("coded");
  });

  test("skill learning improves routing", async () => {
    const sc = new SkillCoordinator();
    const a = sc.register({ name: "A", skills: ["qa"], handler: ok });
    const b = sc.register({ name: "B", skills: ["qa"], handler: ok });

    // A is great at QA, B is bad
    for (let i = 0; i < 15; i++) {
      sc.recordOutcome({ agent_id: a, skill: "qa", success: true, latency_ms: 100, quality_score: 0.9 });
      sc.recordOutcome({ agent_id: b, skill: "qa", success: false, latency_ms: 500, quality_score: 0.2 });
    }

    const profileA = sc.getAgentProfile(a);
    const profileB = sc.getAgentProfile(b);
    expect(profileA[0].avg_quality).toBeGreaterThan(profileB[0].avg_quality);
  });

  test("agent loses skill after consistent failure", async () => {
    const sc = new SkillCoordinator();
    const id = sc.register({ name: "Flaky", skills: ["math", "code"], handler: ok });
    sc.register({ name: "MathExpert", skills: ["math"], handler: async (h) => ({ accepted: true, agent_id: h.to_agent, response: "math done" }) });

    // Flaky consistently fails at math (10+ attempts, <30%)
    for (let i = 0; i < 12; i++) {
      sc.recordOutcome({ agent_id: id, skill: "math", success: false, latency_ms: 100 });
    }

    // Now handoff by skill "math" should prefer MathExpert over Flaky
    const result = await sc.handoffBySkill("ext", "c1", [], ["math"], "need math");
    expect(result.accepted).toBe(true);
    expect(result.response).toBe("math done"); // MathExpert, not Flaky
  });

  test("agent learns NEW skill from outcomes", () => {
    const sc = new SkillCoordinator();
    const id = sc.register({ name: "Learner", skills: ["code"], handler: ok });

    // Starts doing well at "debugging" even though not registered with it
    for (let i = 0; i < 5; i++) {
      sc.recordOutcome({ agent_id: id, skill: "debugging", success: true, latency_ms: 100, quality_score: 0.8 });
    }

    const agents = sc.getCoordinator().listAgents();
    const learner = agents.find(a => a.agent_id === id)!;
    expect(learner.capabilities).toContain("debugging"); // learned it
  });

  test("getSkillGaps finds uncovered skills", () => {
    const registry = new SkillRegistry();
    registry.registerSkill({ id: "code", name: "Code", description: "", category: "coding" });
    registry.registerSkill({ id: "math", name: "Math", description: "", category: "reasoning" });
    registry.registerSkill({ id: "art", name: "Art", description: "", category: "domain_specific" });

    const sc = new SkillCoordinator(undefined, registry);
    sc.register({ name: "Coder", skills: ["code"], handler: ok });

    const gaps = sc.getSkillGaps();
    expect(gaps).toContain("math");
    expect(gaps).toContain("art");
    expect(gaps).not.toContain("code");
  });

  test("getCoverage shows full skill matrix", () => {
    const registry = new SkillRegistry();
    registry.registerSkill({ id: "code", name: "Code", description: "", category: "coding" });
    registry.registerSkill({ id: "test", name: "Test", description: "", category: "verification" });

    const sc = new SkillCoordinator(undefined, registry);
    sc.register({ name: "Dev", skills: ["code", "test"], handler: ok });
    sc.register({ name: "QA", skills: ["test"], handler: ok });

    const coverage = sc.getCoverage();
    const codeCov = coverage.find(c => c.skill === "code")!;
    const testCov = coverage.find(c => c.skill === "test")!;

    expect(codeCov.agents.length).toBe(1);
    expect(codeCov.gap).toBe(false);
    expect(testCov.agents.length).toBe(2);
  });

  test("handoff fails gracefully when no agent has skill", async () => {
    const sc = new SkillCoordinator();
    sc.register({ name: "Coder", skills: ["code"], handler: ok });

    const result = await sc.handoffBySkill("ext", "c1", [], ["quantum_physics"], "need physics");
    expect(result.accepted).toBe(false);
    expect(result.error).toContain("No agent has skills");
  });
});
