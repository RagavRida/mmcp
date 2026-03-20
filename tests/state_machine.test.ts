import { describe, it, expect } from "@jest/globals";
import { ExecutionStateMachine } from "../src/engine/state_machine";
import type { ExecutionState } from "../src/engine/state_machine";

describe("ExecutionStateMachine", () => {

    it("starts in INIT state", () => {
        const sm = new ExecutionStateMachine();
        expect(sm.getCurrentState()).toBe("INIT");
    });

    it("allows INIT → PLANNED → EXECUTING → DONE", () => {
        const sm = new ExecutionStateMachine();
        sm.transition("PLANNED");
        expect(sm.getCurrentState()).toBe("PLANNED");
        sm.transition("EXECUTING");
        expect(sm.getCurrentState()).toBe("EXECUTING");
        sm.transition("DONE");
        expect(sm.getCurrentState()).toBe("DONE");
    });

    it("allows INIT → EXECUTING → VERIFYING → DONE", () => {
        const sm = new ExecutionStateMachine();
        sm.transition("EXECUTING");
        sm.transition("VERIFYING");
        sm.transition("DONE");
        expect(sm.getCurrentState()).toBe("DONE");
    });

    it("allows FAILED → EXECUTING (retry)", () => {
        const sm = new ExecutionStateMachine();
        sm.transition("EXECUTING");
        sm.transition("FAILED");
        expect(sm.getCurrentState()).toBe("FAILED");
        sm.transition("EXECUTING", "retry after failure");
        expect(sm.getCurrentState()).toBe("EXECUTING");
    });

    it("throws on invalid transition", () => {
        const sm = new ExecutionStateMachine();
        expect(() => sm.transition("DONE")).toThrow("Invalid state transition");
    });

    it("throws on transition from DONE (terminal)", () => {
        const sm = new ExecutionStateMachine("DONE");
        expect(() => sm.transition("EXECUTING")).toThrow("Invalid state transition");
    });

    it("records transition history", () => {
        const sm = new ExecutionStateMachine("INIT", "ctx_test");
        sm.transition("PLANNED");
        sm.transition("EXECUTING");
        sm.transition("DONE");
        const history = sm.getHistory();
        expect(history).toHaveLength(3);
        expect(history[0].from).toBe("INIT");
        expect(history[0].to).toBe("PLANNED");
        expect(history[2].to).toBe("DONE");
        expect(history[0].ctx_id).toBe("ctx_test");
    });

    it("canTransition returns correct booleans", () => {
        const sm = new ExecutionStateMachine();
        expect(sm.canTransition("PLANNED")).toBe(true);
        expect(sm.canTransition("EXECUTING")).toBe(true);
        expect(sm.canTransition("DONE")).toBe(false);
    });

    it("allowedTransitions lists valid next states", () => {
        const sm = new ExecutionStateMachine("EXECUTING");
        const allowed = sm.allowedTransitions();
        expect(allowed).toContain("VERIFYING");
        expect(allowed).toContain("DONE");
        expect(allowed).toContain("FAILED");
        expect(allowed).not.toContain("INIT");
    });

    it("reset() returns to INIT", () => {
        const sm = new ExecutionStateMachine();
        sm.transition("PLANNED");
        sm.transition("EXECUTING");
        sm.reset("full retry");
        expect(sm.getCurrentState()).toBe("INIT");
    });

    it("maps to legacy status correctly", () => {
        expect(ExecutionStateMachine.toLegacyStatus("INIT")).toBe("pending");
        expect(ExecutionStateMachine.toLegacyStatus("PLANNED")).toBe("pending");
        expect(ExecutionStateMachine.toLegacyStatus("EXECUTING")).toBe("running");
        expect(ExecutionStateMachine.toLegacyStatus("VERIFYING")).toBe("running");
        expect(ExecutionStateMachine.toLegacyStatus("DONE")).toBe("done");
        expect(ExecutionStateMachine.toLegacyStatus("FAILED")).toBe("failed");
    });

    it("maps from legacy status correctly", () => {
        expect(ExecutionStateMachine.fromLegacyStatus("pending")).toBe("INIT");
        expect(ExecutionStateMachine.fromLegacyStatus("running")).toBe("EXECUTING");
        expect(ExecutionStateMachine.fromLegacyStatus("done")).toBe("DONE");
        expect(ExecutionStateMachine.fromLegacyStatus("failed")).toBe("FAILED");
        expect(ExecutionStateMachine.fromLegacyStatus("skipped")).toBe("FAILED");
    });

    it("VERIFYING → EXECUTING (retry after verification fail)", () => {
        const sm = new ExecutionStateMachine();
        sm.transition("EXECUTING");
        sm.transition("VERIFYING");
        sm.transition("EXECUTING", "verification failed, retrying");
        expect(sm.getCurrentState()).toBe("EXECUTING");
    });
});
