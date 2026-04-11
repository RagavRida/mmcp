import { describe, test, expect } from "@jest/globals";
import { AgentCoordinator, CoordinationEvent, HandoffPayload } from "../src/coordination/coordinator";

describe("AgentCoordinator", () => {
  test("register and list agents", () => {
    const coord = new AgentCoordinator();
    const id = coord.register({
      name: "Support Agent",
      capabilities: ["customer_support", "billing"],
      handler: async () => ({ accepted: true, agent_id: "" }),
    });

    const agents = coord.listAgents();
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe("Support Agent");
    expect(agents[0].agent_id).toBe(id);
  });

  test("discover agents by capability", () => {
    const coord = new AgentCoordinator();
    coord.register({ name: "Coder", capabilities: ["code_generation", "debugging"], handler: async () => ({ accepted: true, agent_id: "" }) });
    coord.register({ name: "Writer", capabilities: ["writing", "editing"], handler: async () => ({ accepted: true, agent_id: "" }) });
    coord.register({ name: "Reviewer", capabilities: ["code_review", "debugging"], handler: async () => ({ accepted: true, agent_id: "" }) });

    const coders = coord.discover(["code_generation"]);
    expect(coders.length).toBe(1);
    expect(coders[0].name).toBe("Coder");

    const debuggers = coord.discover(["debugging"]);
    expect(debuggers.length).toBe(2);
  });

  test("findBest returns highest capability match", () => {
    const coord = new AgentCoordinator();
    coord.register({ name: "Generalist", capabilities: ["code", "writing"], handler: async () => ({ accepted: true, agent_id: "" }) });
    coord.register({ name: "Specialist", capabilities: ["code", "debugging", "testing"], handler: async () => ({ accepted: true, agent_id: "" }) });

    const best = coord.findBest(["code", "debugging", "testing"]);
    expect(best!.name).toBe("Specialist");
  });

  test("shared memory read/write", () => {
    const coord = new AgentCoordinator();
    const id = coord.register({ name: "A", capabilities: [], handler: async () => ({ accepted: true, agent_id: "" }) });

    coord.write(id, "user_intent", "billing question");
    coord.write(id, "sentiment", "frustrated");

    const intent = coord.read(id, "user_intent");
    expect(intent).toBe("billing question");

    const sentiment = coord.read(id, "sentiment");
    expect(sentiment).toBe("frustrated");
  });

  test("shared memory TTL expires entries", async () => {
    const coord = new AgentCoordinator();
    const id = coord.register({ name: "A", capabilities: [], handler: async () => ({ accepted: true, agent_id: "" }) });

    coord.write(id, "temp", "value", 50); // 50ms TTL
    expect(coord.read(id, "temp")).toBe("value");

    await new Promise(r => setTimeout(r, 60));
    expect(coord.read(id, "temp")).toBeUndefined();
  });

  test("shared memory versioning", () => {
    const coord = new AgentCoordinator();
    const id = coord.register({ name: "A", capabilities: [], handler: async () => ({ accepted: true, agent_id: "" }) });

    coord.write(id, "counter", 1);
    coord.write(id, "counter", 2);
    coord.write(id, "counter", 3);

    const all = coord.readAll();
    expect(all.get("counter")!.version).toBe(3);
    expect(all.get("counter")!.value).toBe(3);
  });

  test("handoff transfers conversation to target agent", async () => {
    const coord = new AgentCoordinator();
    let received: HandoffPayload | null = null;

    const agentA = coord.register({ name: "Agent A", capabilities: ["intake"], handler: async () => ({ accepted: true, agent_id: "" }) });
    const agentB = coord.register({
      name: "Agent B", capabilities: ["billing"],
      handler: async (payload) => {
        received = payload;
        return { accepted: true, agent_id: payload.to_agent, response: "I can help with billing." };
      },
    });

    const result = await coord.handoff({
      from_agent: agentA,
      to_agent: agentB,
      conversation_id: "conv_1",
      messages: [{ role: "user", content: "I have a billing question" }],
      context: { plan: "enterprise" },
      reason: "billing",
      priority: "normal",
    });

    expect(result.accepted).toBe(true);
    expect(result.response).toBe("I can help with billing.");
    expect(received).not.toBeNull();
    expect(received!.messages[0].content).toBe("I have a billing question");
    expect(received!.context.plan).toBe("enterprise");
  });

  test("autoHandoff discovers and hands off", async () => {
    const coord = new AgentCoordinator();
    const agentA = coord.register({ name: "Intake", capabilities: ["intake"], handler: async () => ({ accepted: true, agent_id: "" }) });
    coord.register({
      name: "Billing Expert", capabilities: ["billing", "payments"],
      handler: async (p) => ({ accepted: true, agent_id: p.to_agent, response: "Handling billing" }),
    });

    const result = await coord.autoHandoff(
      agentA, "conv_1",
      [{ role: "user", content: "refund please" }],
      ["billing"],
      "billing_request",
    );

    expect(result.accepted).toBe(true);
    expect(result.response).toBe("Handling billing");
  });

  test("handoff includes shared memory snapshot", async () => {
    const coord = new AgentCoordinator();
    let receivedContext: any = null;

    const agentA = coord.register({ name: "A", capabilities: [], handler: async () => ({ accepted: true, agent_id: "" }) });
    const agentB = coord.register({
      name: "B", capabilities: ["handle"],
      handler: async (p) => { receivedContext = p.context; return { accepted: true, agent_id: p.to_agent }; },
    });

    // Agent A writes to shared memory
    coord.write(agentA, "user_tier", "premium");
    coord.write(agentA, "issue_count", 3);

    await coord.handoff({
      from_agent: agentA, to_agent: agentB, conversation_id: "c1",
      messages: [], context: {}, reason: "escalation", priority: "urgent",
    });

    // Agent B should see the shared memory
    expect(receivedContext.shared_memory).toBeDefined();
  });

  test("events fire on coordination actions", async () => {
    const events: CoordinationEvent[] = [];
    const coord = new AgentCoordinator();
    coord.on((e) => events.push(e));

    const id = coord.register({ name: "A", capabilities: ["x"], handler: async () => ({ accepted: true, agent_id: "" }) });
    coord.write(id, "key", "val");
    coord.read(id, "key");
    coord.discover(["x"]);
    coord.unregister(id);

    const types = events.map(e => e.type);
    expect(types).toContain("agent:joined");
    expect(types).toContain("memory:write");
    expect(types).toContain("memory:read");
    expect(types).toContain("discovery:query");
    expect(types).toContain("agent:left");
  });

  test("unregistered agents excluded from discovery", () => {
    const coord = new AgentCoordinator();
    const id = coord.register({ name: "A", capabilities: ["code"], handler: async () => ({ accepted: true, agent_id: "" }) });

    expect(coord.discover(["code"]).length).toBe(1);
    coord.unregister(id);
    expect(coord.discover(["code"]).length).toBe(0);
  });
});
