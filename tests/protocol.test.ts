import { describe, it, expect } from "@jest/globals";
import { MMCPProtocol } from "../src/protocol/message";
import type { MMCPMessage } from "../src/protocol/message";

describe("MMCPProtocol", () => {

    it("creates a message with auto-generated ID and timestamp", () => {
        const msg = MMCPProtocol.createMessage({
            sender: "planner",
            receiver: "executor",
            task_id: "t1",
            intent: "code_generation",
            payload: { code: "console.log('hi')" },
            context_id: "ctx_abc123",
        });

        expect(msg.mmcp_version).toBe("2.0");
        expect(msg.schema_version).toBe("2.0");
        expect(msg.message_id).toMatch(/^msg_/);
        expect(msg.trace_id).toMatch(/^trace_/);
        expect(msg.parent_message_id).toBeUndefined();
        expect(msg.sender).toBe("planner");
        expect(msg.receiver).toBe("executor");
        expect(msg.status).toBe("pending");
        expect(msg.confidence).toBe(0);
        expect(msg.timestamp).toBeDefined();
    });

    it("applies explicit confidence and status", () => {
        const msg = MMCPProtocol.createMessage({
            sender: "verifier",
            receiver: "executor",
            task_id: "t1",
            intent: "verification",
            payload: {},
            context_id: "ctx_xyz",
            confidence: 0.92,
            status: "success",
        });

        expect(msg.confidence).toBe(0.92);
        expect(msg.status).toBe("success");
    });

    it("validates correct message", () => {
        const msg = MMCPProtocol.createMessage({
            sender: "a",
            receiver: "b",
            task_id: "t1",
            intent: "analysis",
            payload: {},
            context_id: "ctx_1",
        });
        const result = MMCPProtocol.validate(msg);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("validates detects missing fields", () => {
        const bad = {
            mmcp_version: "2.0",
            schema_version: "2.0",
            message_id: "msg_abc",
            trace_id: "trace_abc",
            sender: "",
            receiver: "",
            task_id: "",
            intent: "analysis",
            payload: {},
            context_id: "",
            confidence: 0,
            status: "pending",
            timestamp: new Date().toISOString(),
        } as MMCPMessage;

        const result = MMCPProtocol.validate(bad);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("validates detects invalid confidence", () => {
        const msg = MMCPProtocol.createMessage({
            sender: "a",
            receiver: "b",
            task_id: "t1",
            intent: "analysis",
            payload: {},
            context_id: "ctx_1",
            confidence: 1.5,
        });
        const result = MMCPProtocol.validate(msg);
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes("confidence"))).toBe(true);
    });

    it("serialize → deserialize round-trip", () => {
        const msg = MMCPProtocol.createMessage({
            sender: "planner",
            receiver: "executor",
            task_id: "t1",
            intent: "code_generation",
            payload: { lang: "typescript" },
            context_id: "ctx_round",
            confidence: 0.85,
            status: "success",
        });

        const json = MMCPProtocol.serialize(msg);
        const deserialized = MMCPProtocol.deserialize(json);

        expect(deserialized.message_id).toBe(msg.message_id);
        expect(deserialized.sender).toBe("planner");
        expect(deserialized.payload).toEqual({ lang: "typescript" });
        expect(deserialized.confidence).toBe(0.85);
    });

    it("deserialize throws on invalid JSON message", () => {
        expect(() => MMCPProtocol.deserialize("{}")).toThrow("Invalid MMCPMessage");
    });

    it("reply creates message with in_reply_to", () => {
        const original = MMCPProtocol.createMessage({
            sender: "planner",
            receiver: "executor",
            task_id: "t1",
            intent: "code_generation",
            payload: {},
            context_id: "ctx_1",
        });

        const response = MMCPProtocol.reply(original, {
            sender: "executor",
            payload: { result: "done" },
            status: "success",
            confidence: 0.95,
        });

        expect(response.sender).toBe("executor");
        expect(response.receiver).toBe("planner");
        expect(response.task_id).toBe("t1");
        expect(response.status).toBe("success");
        expect(response.payload.in_reply_to).toBe(original.message_id);
        expect(response.trace_id).toBe(original.trace_id);
        expect(response.parent_message_id).toBe(original.message_id);
    });
});
