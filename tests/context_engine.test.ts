import { describe, it, expect } from "@jest/globals";
import { ContextEngine } from "../src/engine/context_engine";

describe("ContextEngine", () => {

    it("creates a task with auto-generated ID", () => {
        const engine = new ContextEngine();
        const task = engine.createTask("session_1", "Build a login system");
        expect(task.task_id).toMatch(/^task_/);
        expect(task.session_id).toBe("session_1");
        expect(task.description).toBe("Build a login system");
        expect(task.status).toBe("INIT");
        expect(task.steps).toHaveLength(0);
    });

    it("records steps within a task", () => {
        const engine = new ContextEngine();
        const task = engine.createTask("s1", "Test task");
        const step = engine.recordStep(task.task_id, {
            agent: "planner",
            ctx_id: "ctx_001",
            input: "plan the login",
            output: "step 1: design DB",
            model: "gpt-4",
            latency_ms: 1200,
            tokens_used: 500,
            cost_usd: 0.005,
            confidence: 0.9,
        });

        expect(step.step_id).toMatch(/^step_/);
        expect(task.steps).toHaveLength(1);
        expect(task.total_tokens).toBe(500);
        expect(task.total_cost_usd).toBe(0.005);
    });

    it("completes a task with output and confidence", () => {
        const engine = new ContextEngine();
        const task = engine.createTask("s1", "Test task");
        engine.completeTask(task.task_id, "Final result", 0.91);

        const retrieved = engine.getTask(task.task_id)!;
        expect(retrieved.status).toBe("DONE");
        expect(retrieved.final_output).toBe("Final result");
        expect(retrieved.confidence).toBe(0.91);
        expect(retrieved.completed_at).toBeDefined();
    });

    it("fails a task with reason", () => {
        const engine = new ContextEngine();
        const task = engine.createTask("s1", "Test task");
        engine.failTask(task.task_id, "API timeout");

        const retrieved = engine.getTask(task.task_id)!;
        expect(retrieved.status).toBe("FAILED");
        expect(retrieved.metadata.failure_reason).toBe("API timeout");
    });

    it("links tasks for cross-task memory", () => {
        const engine = new ContextEngine();
        const t1 = engine.createTask("s1", "First task");
        engine.completeTask(t1.task_id, "Task 1 done", 0.8);

        const t2 = engine.createTask("s1", "Second task", [t1.task_id]);

        const linked = engine.getLinkedTasks(t2.task_id);
        expect(linked).toHaveLength(1);
        expect(linked[0].task_id).toBe(t1.task_id);
    });

    it("linkTask adds references", () => {
        const engine = new ContextEngine();
        const t1 = engine.createTask("s1", "First");
        const t2 = engine.createTask("s1", "Second");
        engine.linkTask(t2.task_id, t1.task_id);
        expect(engine.getTask(t2.task_id)!.context_refs).toContain(t1.task_id);
    });

    it("findSimilarTasks matches by keywords", () => {
        const engine = new ContextEngine();
        engine.createTask("s1", "Build a JWT login system");
        engine.createTask("s1", "Deploy to production");
        engine.createTask("s1", "Fix login page CSS");

        const results = engine.findSimilarTasks("login system");
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].description).toContain("login");
    });

    it("getSession returns tasks for a session", () => {
        const engine = new ContextEngine();
        engine.createTask("session_a", "Task 1");
        engine.createTask("session_a", "Task 2");
        engine.createTask("session_b", "Task 3");

        const sessionA = engine.getSession("session_a");
        expect(sessionA).toHaveLength(2);

        const sessionB = engine.getSession("session_b");
        expect(sessionB).toHaveLength(1);
    });

    it("listTasks filters by status", () => {
        const engine = new ContextEngine();
        const t1 = engine.createTask("s1", "Task 1");
        const t2 = engine.createTask("s1", "Task 2");
        engine.completeTask(t1.task_id, "done", 0.9);

        const done = engine.listTasks({ status: "DONE" });
        expect(done).toHaveLength(1);
        expect(done[0].task_id).toBe(t1.task_id);

        const init = engine.listTasks({ status: "INIT" });
        expect(init).toHaveLength(1);
    });

    it("size and clear work correctly", () => {
        const engine = new ContextEngine();
        engine.createTask("s1", "A");
        engine.createTask("s1", "B");
        expect(engine.size).toBe(2);
        engine.clear();
        expect(engine.size).toBe(0);
    });

    it("throws on unknown task_id", () => {
        const engine = new ContextEngine();
        expect(() => engine.recordStep("bad_id", {
            agent: "x", ctx_id: "c", input: "", output: "",
            model: "m", latency_ms: 0, tokens_used: 0, cost_usd: 0,
        })).toThrow("Task not found");
    });
});
