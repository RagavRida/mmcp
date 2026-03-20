// ─────────────────────────────────────────────────────────────────────────────
// MMCP Protocol  |  v2.0  —  Inter-Agent Message Protocol
// Wraps ContextEnvelope with sender/receiver semantics, intent, and status.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from "uuid";

// ── Message Status ───────────────────────────────────────────────────────────

export type MessageStatus = "pending" | "success" | "failed" | "retry";

// ── Intent Types ─────────────────────────────────────────────────────────────

export type MessageIntent =
    | "code_generation"
    | "review"
    | "verification"
    | "analysis"
    | "synthesis"
    | "classification"
    | "summarization"
    | "planning"
    | "execution"
    | "handoff"
    | "custom";

// ── MMCP Message ─────────────────────────────────────────────────────────────

export interface MMCPMessage {
    mmcp_version: "2.0";
    schema_version: "2.0";             // ← protocol schema version for forward compat
    message_id: string;
    trace_id: string;                  // ← global execution trace (distributed tracing)
    parent_message_id?: string;        // ← DAG lineage: which message spawned this one
    idempotency_key?: string;          // ← deduplication key for retries/network replay
    sender: string;                    // role or agent ID
    receiver: string;                  // role or agent ID
    task_id: string;
    intent: MessageIntent;
    payload: Record<string, unknown>;
    context_id: string;                // links to ContextEnvelope.id
    confidence: number;                // 0.0–1.0
    status: MessageStatus;
    timestamp: string;                 // ISO 8601
    metadata?: Record<string, unknown>;
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface MessageValidationResult {
    valid: boolean;
    errors: string[];
}

// ── MMCPProtocol ─────────────────────────────────────────────────────────────

export class MMCPProtocol {

    /** Create a new protocol message with auto-generated ID and timestamp. */
    static createMessage(params: {
        sender: string;
        receiver: string;
        task_id: string;
        intent: MessageIntent;
        payload: Record<string, unknown>;
        context_id: string;
        confidence?: number;
        status?: MessageStatus;
        trace_id?: string;
        parent_message_id?: string;
        metadata?: Record<string, unknown>;
    }): MMCPMessage {
        return {
            mmcp_version: "2.0",
            schema_version: "2.0",
            message_id: `msg_${uuidv4().replace(/-/g, "")}`,
            trace_id: params.trace_id ?? `trace_${uuidv4().replace(/-/g, "")}`,
            parent_message_id: params.parent_message_id,
            sender: params.sender,
            receiver: params.receiver,
            task_id: params.task_id,
            intent: params.intent,
            payload: params.payload,
            context_id: params.context_id,
            confidence: params.confidence ?? 0,
            status: params.status ?? "pending",
            timestamp: new Date().toISOString(),
            metadata: params.metadata,
        };
    }

    /** Validate a message structure. */
    static validate(message: MMCPMessage): MessageValidationResult {
        const errors: string[] = [];

        if (message.mmcp_version !== "2.0") {
            errors.push(`mmcp_version must be "2.0", got "${message.mmcp_version}"`);
        }
        if (!message.message_id || !message.message_id.startsWith("msg_")) {
            errors.push(`message_id must start with "msg_", got "${message.message_id}"`);
        }
        if (!message.sender) {
            errors.push("sender is required");
        }
        if (!message.receiver) {
            errors.push("receiver is required");
        }
        if (!message.task_id) {
            errors.push("task_id is required");
        }
        if (!message.context_id) {
            errors.push("context_id is required");
        }
        if (message.confidence < 0 || message.confidence > 1) {
            errors.push(`confidence must be between 0 and 1, got ${message.confidence}`);
        }
        const validStatuses: MessageStatus[] = ["pending", "success", "failed", "retry"];
        if (!validStatuses.includes(message.status)) {
            errors.push(`status must be one of ${validStatuses.join(", ")}, got "${message.status}"`);
        }

        return { valid: errors.length === 0, errors };
    }

    /** Serialize a message to JSON string. */
    static serialize(message: MMCPMessage): string {
        return JSON.stringify(message);
    }

    /** Deserialize a JSON string to an MMCPMessage. Throws on invalid JSON. */
    static deserialize(json: string): MMCPMessage {
        const parsed = JSON.parse(json) as MMCPMessage;
        const validation = MMCPProtocol.validate(parsed);
        if (!validation.valid) {
            throw new Error(`Invalid MMCPMessage: ${validation.errors.join("; ")}`);
        }
        return parsed;
    }

    /** Create a reply to an existing message. Inherits trace_id for distributed tracing. */
    static reply(
        original: MMCPMessage,
        params: {
            sender: string;
            payload: Record<string, unknown>;
            confidence?: number;
            status: MessageStatus;
            metadata?: Record<string, unknown>;
        }
    ): MMCPMessage {
        return MMCPProtocol.createMessage({
            sender: params.sender,
            receiver: original.sender,
            task_id: original.task_id,
            intent: original.intent,
            payload: {
                ...params.payload,
                in_reply_to: original.message_id,
            },
            context_id: original.context_id,
            confidence: params.confidence ?? 0,
            status: params.status,
            trace_id: original.trace_id,
            parent_message_id: original.message_id,
            metadata: params.metadata,
        });
    }
}
