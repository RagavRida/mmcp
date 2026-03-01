// ─────────────────────────────────────────────────────────────────────────────
// MMCP Wire Format  |  v1.0 Stable Serialization Standard
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import {
    ContextEnvelope, BranchType, ContextStatus, MergeStrategy, Message
} from "../core/types";

// ── Model Pricing (per 1M tokens) ────────────────────────────────────────────

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
    "claude-opus-4-20250514": { input: 15, output: 75 },
    "claude-sonnet-4-20250514": { input: 3, output: 15 },
    "claude-haiku-4-5-20251001": { input: 0.25, output: 1.25 },
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gemini-pro-1.5": { input: 1.25, output: 5 },
    "gemini-flash-1.5": { input: 0.075, output: 0.3 },
    "mistral-large": { input: 3, output: 9 },
};

// ── Wire Types ───────────────────────────────────────────────────────────────

export interface WireMessage {
    role: "user" | "assistant" | "system";
    content: string;
    ctx_id?: string;
    timestamp?: string;
}

export interface WireCompliance {
    dag_valid: boolean;
    append_only: boolean;
    audit_hash: string;
    signed_by?: string;
    verified_by?: string[];
    regulation_tags?: string[];
}

export interface WireEnvelope {
    // Protocol
    mmcp: "1.0";
    envelope_id: string;
    schema: "https://mmcp.dev/schema/1.0/envelope.json";

    // Identity
    id: string;
    parent_ids: string[];
    children: string[];

    // Task
    task: string;
    history: WireMessage[];
    system_prompt?: string;

    // Routing
    model: string;
    role: string;
    required_skills?: string[];
    matched_skills?: string[];

    // Structure
    branch_type: BranchType;
    depth: number;
    shard_index?: number;
    merge_strategy?: MergeStrategy;

    // Execution
    status: ContextStatus;
    confidence?: number;
    retry_count: number;
    max_retries: number;

    // Skills
    skill_score?: number;
    missing_skills?: string[];

    // Output
    output?: string;
    output_format?: "text" | "json" | "markdown" | "code";

    // Telemetry
    tokens_used?: number;
    input_tokens?: number;
    output_tokens?: number;
    cost_usd?: number;
    created_at: string;
    started_at?: string;
    completed_at?: string;
    duration_ms?: number;
    error?: string;

    // Compliance
    compliance: WireCompliance;
    metadata: Record<string, unknown>;
}

export interface AuditChainEntry {
    sequence: number;
    ctx_id: string;
    role: string;
    model: string;
    branch_type: BranchType;
    parent_ids: string[];
    started_at: string;
    completed_at: string;
    audit_hash: string;
    output_preview: string;
}

export interface ComplianceError {
    code: string;
    message: string;
    ctx_id?: string;
}

export interface ComplianceWarning {
    code: string;
    message: string;
    ctx_id?: string;
}

export interface DAGComplianceReport {
    dag_id: string;
    valid: boolean;
    errors: ComplianceError[];
    warnings: ComplianceWarning[];
    audit_chain: AuditChainEntry[];
    verified_nodes: string[];
    unverified_nodes: string[];
    total_nodes: number;
    parallel_nodes: number;
    merge_nodes: number;
    shard_nodes: number;
    verify_nodes: number;
    regulation_compliance: Record<string, boolean>;
}

export interface WireDAG {
    mmcp: "1.0";
    dag_id: string;
    schema: "https://mmcp.dev/schema/1.0/dag.json";
    created_at: string;
    completed_at?: string;
    envelopes: WireEnvelope[];
    compliance_report: DAGComplianceReport;
    skill_report?: Record<string, unknown>;
    shared_context_snapshot?: Record<string, unknown>;
    total_tokens: number;
    total_cost_usd: number;
    regulation_tags: string[];
}

export interface ValidationResult {
    valid: boolean;
    errors: ComplianceError[];
    warnings: ComplianceWarning[];
}

// ── Wire Format Error ────────────────────────────────────────────────────────

export class WireFormatError extends Error {
    constructor(message: string) {
        super(`WireFormatError: ${message}`);
        this.name = "WireFormatError";
    }
}

// ── MMCPWireFormat ───────────────────────────────────────────────────────────

export class MMCPWireFormat {

    // ── audit_hash ─────────────────────────────────────────────────────────────

    static computeAuditHash(
        id: string,
        parentIds: string[],
        output: string | undefined,
        completedAt: string | undefined
    ): string {
        const payload = `${id}${parentIds.join(",")}${output ?? ""}${completedAt ?? ""}`;
        return createHash("sha256").update(payload).digest("hex");
    }

    // ── cost_usd ───────────────────────────────────────────────────────────────

    static calculateCost(
        model: string,
        inputTokens: number,
        outputTokens: number
    ): number {
        const pricing = MODEL_PRICING[model];
        if (!pricing) return 0;
        return (inputTokens / 1_000_000) * pricing.input
            + (outputTokens / 1_000_000) * pricing.output;
    }

    // ── DAG Cycle Detection ────────────────────────────────────────────────────

    private static hasCycle(envelopes: ContextEnvelope[]): boolean {
        const WHITE = 0, GRAY = 1, BLACK = 2;
        const color = new Map<string, number>();
        for (const e of envelopes) color.set(e.id, WHITE);

        // Build adjacency: parent → child
        const children = new Map<string, string[]>();
        for (const e of envelopes) {
            for (const p of e.parent_ids) {
                if (!children.has(p)) children.set(p, []);
                children.get(p)!.push(e.id);
            }
        }

        function dfs(id: string): boolean {
            color.set(id, GRAY);
            for (const child of (children.get(id) ?? [])) {
                const c = color.get(child);
                if (c === GRAY) return true; // back edge = cycle
                if (c === WHITE && dfs(child)) return true;
            }
            color.set(id, BLACK);
            return false;
        }

        for (const e of envelopes) {
            if (color.get(e.id) === WHITE && dfs(e.id)) return true;
        }
        return false;
    }

    // ── All parent_ids reference existing nodes ────────────────────────────────

    private static allParentsExist(envelopes: ContextEnvelope[]): boolean {
        const ids = new Set(envelopes.map(e => e.id));
        for (const e of envelopes) {
            for (const p of e.parent_ids) {
                if (!ids.has(p)) return false;
            }
        }
        return true;
    }

    // ── serialize ──────────────────────────────────────────────────────────────

    serialize(envelope: ContextEnvelope, dagContexts?: ContextEnvelope[]): WireEnvelope {
        const contexts = dagContexts ?? [envelope];
        const dagValid = !MMCPWireFormat.hasCycle(contexts) && MMCPWireFormat.allParentsExist(contexts);

        const inputTokens = (envelope as any).input_tokens ?? Math.round((envelope.tokens_used ?? 0) * 0.6);
        const outputTokens = (envelope as any).output_tokens ?? ((envelope.tokens_used ?? 0) - inputTokens);

        const auditHash = MMCPWireFormat.computeAuditHash(
            envelope.id,
            envelope.parent_ids,
            envelope.output,
            envelope.completed_at
        );

        const costUsd = MMCPWireFormat.calculateCost(envelope.model, inputTokens, outputTokens);

        const history: WireMessage[] = envelope.history.map(m => ({
            role: m.role,
            content: m.content,
        }));

        return {
            mmcp: "1.0",
            envelope_id: `mmcp_${uuidv4().replace(/-/g, "")}`,
            schema: "https://mmcp.dev/schema/1.0/envelope.json",

            id: envelope.id,
            parent_ids: envelope.parent_ids,
            children: envelope.children,

            task: envelope.task,
            history,
            system_prompt: envelope.system_prompt,

            model: envelope.model,
            role: envelope.role,
            required_skills: envelope.required_skills,
            matched_skills: envelope.matched_skills,

            branch_type: envelope.branch_type,
            depth: envelope.depth,
            shard_index: envelope.shard_index,
            merge_strategy: envelope.merge_strategy,

            status: envelope.status,
            confidence: envelope.confidence,
            retry_count: envelope.retry_count,
            max_retries: envelope.max_retries,

            skill_score: envelope.skill_score,
            missing_skills: envelope.missing_skills,

            output: envelope.output,
            output_format: "text",

            tokens_used: envelope.tokens_used,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cost_usd: costUsd,
            created_at: envelope.created_at,
            started_at: envelope.started_at,
            completed_at: envelope.completed_at,
            duration_ms: envelope.duration_ms,
            error: envelope.error,

            compliance: {
                dag_valid: dagValid,
                append_only: true,
                audit_hash: auditHash,
                signed_by: envelope.status === "done" ? envelope.model : undefined,
                verified_by: envelope.branch_type === "verify"
                    ? (envelope.metadata?.verified_by as string[] | undefined)
                    : undefined,
                regulation_tags: (envelope.metadata?.regulation_tags as string[] | undefined),
            },
            metadata: envelope.metadata,
        };
    }

    // ── deserialize ────────────────────────────────────────────────────────────

    deserialize(wire: WireEnvelope): ContextEnvelope {
        // Validate audit hash
        const expectedHash = MMCPWireFormat.computeAuditHash(
            wire.id,
            wire.parent_ids,
            wire.output,
            wire.completed_at
        );
        if (wire.compliance.audit_hash !== expectedHash) {
            throw new WireFormatError(
                `Audit hash mismatch for ${wire.id}: expected ${expectedHash}, got ${wire.compliance.audit_hash}`
            );
        }

        const messages: Message[] = wire.history.map(m => ({
            role: m.role,
            content: m.content,
        }));

        return {
            mmcp_version: "0.1" as any, // internal version stays as-is
            id: wire.id,
            parent_ids: wire.parent_ids,
            children: wire.children,
            task: wire.task,
            history: messages,
            system_prompt: wire.system_prompt,
            model: wire.model,
            role: wire.role,
            required_skills: wire.required_skills,
            matched_skills: wire.matched_skills,
            missing_skills: wire.missing_skills,
            skill_score: wire.skill_score,
            branch_type: wire.branch_type,
            depth: wire.depth,
            shard_index: wire.shard_index,
            merge_strategy: wire.merge_strategy,
            status: wire.status,
            confidence: wire.confidence,
            retry_count: wire.retry_count,
            max_retries: wire.max_retries,
            output: wire.output,
            tokens_used: wire.tokens_used,
            created_at: wire.created_at,
            started_at: wire.started_at,
            completed_at: wire.completed_at,
            duration_ms: wire.duration_ms,
            error: wire.error,
            metadata: {
                ...wire.metadata,
                regulation_tags: wire.compliance.regulation_tags,
                verified_by: wire.compliance.verified_by,
            },
        };
    }

    // ── serializeDAG ───────────────────────────────────────────────────────────

    serializeDAG(
        contexts: ContextEnvelope[],
        options?: {
            skillReport?: Record<string, unknown>;
            sharedSnapshot?: Record<string, unknown>;
            regulationTags?: string[];
        }
    ): WireDAG {
        const envelopes = contexts.map(c => this.serialize(c, contexts));
        const complianceReport = this.buildComplianceReport(contexts, envelopes);

        const totalTokens = envelopes.reduce((s, e) => s + (e.tokens_used ?? 0), 0);
        const totalCost = envelopes.reduce((s, e) => s + (e.cost_usd ?? 0), 0);

        // Union all regulation tags
        const regTags = new Set<string>();
        for (const e of envelopes) {
            for (const tag of (e.compliance.regulation_tags ?? [])) {
                regTags.add(tag);
            }
        }
        if (options?.regulationTags) {
            for (const tag of options.regulationTags) regTags.add(tag);
        }

        const completedEnvelopes = envelopes.filter(e => e.completed_at);
        const latestCompleted = completedEnvelopes.length > 0
            ? completedEnvelopes.sort((a, b) =>
                new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime()
            )[0].completed_at
            : undefined;

        return {
            mmcp: "1.0",
            dag_id: `mmcp_dag_${uuidv4().replace(/-/g, "")}`,
            schema: "https://mmcp.dev/schema/1.0/dag.json",
            created_at: envelopes[0]?.created_at ?? new Date().toISOString(),
            completed_at: latestCompleted,
            envelopes,
            compliance_report: complianceReport,
            skill_report: options?.skillReport,
            shared_context_snapshot: options?.sharedSnapshot,
            total_tokens: totalTokens,
            total_cost_usd: totalCost,
            regulation_tags: Array.from(regTags),
        };
    }

    // ── deserializeDAG ─────────────────────────────────────────────────────────

    deserializeDAG(wire: WireDAG): ContextEnvelope[] {
        return wire.envelopes.map(e => this.deserialize(e));
    }

    // ── validate ───────────────────────────────────────────────────────────────

    validate(wire: WireEnvelope): ValidationResult {
        const errors: ComplianceError[] = [];
        const warnings: ComplianceWarning[] = [];

        if (wire.mmcp !== "1.0") {
            errors.push({ code: "WF-003", message: `mmcp field must be "1.0", got "${wire.mmcp}"` });
        }
        if (wire.schema !== "https://mmcp.dev/schema/1.0/envelope.json") {
            errors.push({ code: "WF-004", message: `Invalid schema URL: ${wire.schema}` });
        }
        if (!wire.envelope_id.startsWith("mmcp_")) {
            errors.push({ code: "WF-001", message: `envelope_id must start with "mmcp_", got "${wire.envelope_id}"` });
        }
        if (!Array.isArray(wire.parent_ids)) {
            errors.push({ code: "WF-002", message: "parent_ids must be an array" });
        }
        if (!/^[a-f0-9]{64}$/.test(wire.compliance.audit_hash)) {
            errors.push({ code: "WF-005", message: `audit_hash must be 64 hex chars, got "${wire.compliance.audit_hash}"` });
        }

        // Verify hash integrity
        const expectedHash = MMCPWireFormat.computeAuditHash(
            wire.id, wire.parent_ids, wire.output, wire.completed_at
        );
        if (wire.compliance.audit_hash !== expectedHash) {
            errors.push({ code: "CA-007", message: `audit_hash mismatch: expected ${expectedHash}` });
        }

        // Cost validation
        if (wire.input_tokens !== undefined && wire.output_tokens !== undefined) {
            const expectedCost = MMCPWireFormat.calculateCost(wire.model, wire.input_tokens, wire.output_tokens);
            if (wire.cost_usd !== undefined && Math.abs(wire.cost_usd - expectedCost) > 0.000001) {
                warnings.push({ code: "WF-008", message: `cost_usd mismatch: expected ${expectedCost}, got ${wire.cost_usd}` });
            }
        }

        return { valid: errors.length === 0, errors, warnings };
    }

    // ── Build compliance report ────────────────────────────────────────────────

    private buildComplianceReport(
        contexts: ContextEnvelope[],
        envelopes: WireEnvelope[]
    ): DAGComplianceReport {
        const dagId = `mmcp_dag_${uuidv4().replace(/-/g, "")}`;
        const errors: ComplianceError[] = [];
        const warnings: ComplianceWarning[] = [];

        // Check DAG validity
        const hasCycle = MMCPWireFormat.hasCycle(contexts);
        const parentsExist = MMCPWireFormat.allParentsExist(contexts);

        if (hasCycle) {
            errors.push({ code: "DAG-CYCLE", message: "DAG contains a cycle" });
        }
        if (!parentsExist) {
            errors.push({ code: "DAG-ORPHAN", message: "Some parent_ids reference non-existent nodes" });
        }

        // Build audit chain from completed envelopes in execution order (by completed_at)
        const completedEnvelopes = envelopes
            .filter(e => e.completed_at)
            .sort((a, b) =>
                new Date(a.completed_at!).getTime() - new Date(b.completed_at!).getTime()
            );

        const auditChain: AuditChainEntry[] = completedEnvelopes.map((e, i) => ({
            sequence: i + 1,
            ctx_id: e.id,
            role: e.role,
            model: e.model,
            branch_type: e.branch_type,
            parent_ids: e.parent_ids,
            started_at: e.started_at ?? e.created_at,
            completed_at: e.completed_at!,
            audit_hash: e.compliance.audit_hash,
            output_preview: (e.output ?? "").slice(0, 100),
        }));

        // Identify verified/unverified nodes
        const verifiedNodeIds = new Set<string>();
        for (const ctx of contexts) {
            if (ctx.branch_type === "verify" && ctx.status === "done") {
                // The producer (parent) is verified
                for (const pid of ctx.parent_ids) {
                    verifiedNodeIds.add(pid);
                }
            }
        }
        const allIds = contexts.map(c => c.id);
        const verified = allIds.filter(id => verifiedNodeIds.has(id));
        const unverified = allIds.filter(id => !verifiedNodeIds.has(id));

        // Count node types
        const parallelNodes = contexts.filter(c => c.branch_type === "fork").length;
        const mergeNodes = contexts.filter(c => c.branch_type === "merge").length;
        const shardNodes = contexts.filter(c => c.branch_type === "shard").length;
        const verifyNodes = contexts.filter(c => c.branch_type === "verify").length;

        // Regulation compliance
        const allRegTags = new Set<string>();
        for (const e of envelopes) {
            for (const tag of (e.compliance.regulation_tags ?? [])) {
                allRegTags.add(tag);
            }
        }
        const regulationCompliance: Record<string, boolean> = {};
        for (const tag of allRegTags) {
            regulationCompliance[tag] = true; // assume compliant if tagged
        }

        return {
            dag_id: dagId,
            valid: !hasCycle && parentsExist && errors.length === 0,
            errors,
            warnings,
            audit_chain: auditChain,
            verified_nodes: verified,
            unverified_nodes: unverified,
            total_nodes: contexts.length,
            parallel_nodes: parallelNodes,
            merge_nodes: mergeNodes,
            shard_nodes: shardNodes,
            verify_nodes: verifyNodes,
            regulation_compliance: regulationCompliance,
        };
    }
}
