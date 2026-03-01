// ─────────────────────────────────────────────────────────────────────────────
// MMCP Registry  |  v1.0  —  Pipeline Discovery & Registration
// ─────────────────────────────────────────────────────────────────────────────

import { BranchType, MMCPRunResult } from "../core/types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PipelineSchema {
    entry_role: string;
    exit_role: string;
    nodes: Array<{
        role: string;
        branch_type: BranchType;
        required_skills: string[];
        optional: boolean;
    }>;
    max_depth: number;
    has_parallel: boolean;
    has_verify: boolean;
    has_shard: boolean;
}

export interface MMCPRegistryEntry {
    id: string;
    name: string;
    version: string;
    description: string;
    author?: string;
    tags: string[];
    pipeline_schema: PipelineSchema;
    required_skills: string[];
    supported_vendors: string[];
    regulation_tags: string[];
    created_at: string;
    last_run?: string;
    run_count: number;
    avg_tokens: number;
    avg_cost_usd: number;
    avg_duration_ms: number;
}

export interface RegistryValidationResult {
    valid: boolean;
    errors: string[];
}

// ── MMCPRegistry ─────────────────────────────────────────────────────────────

export class MMCPRegistry {
    private entries = new Map<string, MMCPRegistryEntry>();

    constructor() {
        this.registerBuiltins();
    }

    register(entry: MMCPRegistryEntry): void {
        this.entries.set(entry.id, { ...entry });
    }

    get(id: string): MMCPRegistryEntry | null {
        return this.entries.get(id) ?? null;
    }

    search(query: {
        tags?: string[];
        skills?: string[];
        vendor?: string;
        regulation?: string;
        has_verify?: boolean;
    }): MMCPRegistryEntry[] {
        return Array.from(this.entries.values()).filter(entry => {
            if (query.tags && !query.tags.some(t => entry.tags.includes(t))) return false;
            if (query.skills && !query.skills.some(s => entry.required_skills.includes(s))) return false;
            if (query.vendor && !entry.supported_vendors.includes(query.vendor)) return false;
            if (query.regulation && !entry.regulation_tags.includes(query.regulation)) return false;
            if (query.has_verify !== undefined && entry.pipeline_schema.has_verify !== query.has_verify) return false;
            return true;
        });
    }

    list(): MMCPRegistryEntry[] {
        return Array.from(this.entries.values());
    }

    recordRun(id: string, result: MMCPRunResult): void {
        const entry = this.entries.get(id);
        if (!entry) return;

        const totalCost = (result as any).cost_breakdown?.total_cost_usd ?? 0;
        const prevTotal = entry.avg_tokens * entry.run_count;
        const prevCost = entry.avg_cost_usd * entry.run_count;
        const prevDuration = entry.avg_duration_ms * entry.run_count;

        entry.run_count++;
        entry.avg_tokens = (prevTotal + result.total_tokens) / entry.run_count;
        entry.avg_cost_usd = (prevCost + totalCost) / entry.run_count;
        entry.avg_duration_ms = (prevDuration + result.duration_ms) / entry.run_count;
        entry.last_run = new Date().toISOString();
    }

    export(): string {
        return JSON.stringify(Array.from(this.entries.values()), null, 2);
    }

    import(json: string): void {
        const entries: MMCPRegistryEntry[] = JSON.parse(json);
        for (const entry of entries) {
            this.entries.set(entry.id, entry);
        }
    }

    validate(entry: MMCPRegistryEntry): RegistryValidationResult {
        const errors: string[] = [];
        if (!entry.id) errors.push("id is required");
        if (!entry.name) errors.push("name is required");
        if (!entry.version) errors.push("version is required");
        if (!entry.pipeline_schema) errors.push("pipeline_schema is required");
        if (!entry.pipeline_schema?.entry_role) errors.push("pipeline_schema.entry_role is required");
        if (!entry.pipeline_schema?.exit_role) errors.push("pipeline_schema.exit_role is required");
        return { valid: errors.length === 0, errors };
    }

    // ── Built-in Pipelines ─────────────────────────────────────────────────────

    private registerBuiltins(): void {
        this.register({
            id: "mmcp://pipelines/code-review",
            name: "Code Review Pipeline",
            version: "1.0.0",
            description: "Multi-model code review with security analysis and verification",
            tags: ["engineering", "code"],
            pipeline_schema: {
                entry_role: "architect",
                exit_role: "summarizer",
                nodes: [
                    { role: "architect", branch_type: "root", required_skills: ["planning", "code_review"], optional: false },
                    { role: "security_analyst", branch_type: "fork", required_skills: ["security_analysis", "code_review"], optional: false },
                    { role: "performance_analyst", branch_type: "fork", required_skills: ["code_review", "reasoning"], optional: true },
                    { role: "verifier", branch_type: "merge", required_skills: ["code_review", "fact_checking"], optional: false },
                    { role: "summarizer", branch_type: "handoff", required_skills: ["summarization"], optional: false },
                ],
                max_depth: 4,
                has_parallel: true,
                has_verify: true,
                has_shard: false,
            },
            required_skills: ["code_review", "security_analysis", "summarization"],
            supported_vendors: ["anthropic", "openai", "google"],
            regulation_tags: ["SOC2"],
            created_at: new Date().toISOString(),
            run_count: 0,
            avg_tokens: 0,
            avg_cost_usd: 0,
            avg_duration_ms: 0,
        });

        this.register({
            id: "mmcp://pipelines/legal-review",
            name: "Legal Review Pipeline",
            version: "1.0.0",
            description: "Multi-model legal document review with compliance verification",
            tags: ["legal", "compliance"],
            pipeline_schema: {
                entry_role: "analyst",
                exit_role: "summarizer",
                nodes: [
                    { role: "analyst", branch_type: "root", required_skills: ["data_extraction", "reasoning"], optional: false },
                    { role: "challenger", branch_type: "verify", required_skills: ["reasoning", "fact_checking"], optional: false },
                    { role: "synthesizer", branch_type: "merge", required_skills: ["summarization", "reasoning"], optional: false },
                    { role: "summarizer", branch_type: "handoff", required_skills: ["summarization"], optional: false },
                ],
                max_depth: 4,
                has_parallel: false,
                has_verify: true,
                has_shard: false,
            },
            required_skills: ["data_extraction", "reasoning", "summarization"],
            supported_vendors: ["anthropic", "openai"],
            regulation_tags: ["GDPR", "SOC2"],
            created_at: new Date().toISOString(),
            run_count: 0,
            avg_tokens: 0,
            avg_cost_usd: 0,
            avg_duration_ms: 0,
        });

        this.register({
            id: "mmcp://pipelines/research-synthesis",
            name: "Research Synthesis Pipeline",
            version: "1.0.0",
            description: "Multi-model research with parallel analysis and verification",
            tags: ["research", "analysis"],
            pipeline_schema: {
                entry_role: "researcher",
                exit_role: "synthesizer",
                nodes: [
                    { role: "researcher", branch_type: "root", required_skills: ["reasoning", "web_search"], optional: false },
                    { role: "fact_checker", branch_type: "fork", required_skills: ["fact_checking"], optional: false },
                    { role: "analyst", branch_type: "fork", required_skills: ["reasoning"], optional: false },
                    { role: "challenger", branch_type: "verify", required_skills: ["reasoning", "fact_checking"], optional: false },
                    { role: "synthesizer", branch_type: "merge", required_skills: ["summarization"], optional: false },
                ],
                max_depth: 4,
                has_parallel: true,
                has_verify: true,
                has_shard: false,
            },
            required_skills: ["reasoning", "web_search", "fact_checking", "summarization"],
            supported_vendors: ["anthropic", "openai", "google"],
            regulation_tags: [],
            created_at: new Date().toISOString(),
            run_count: 0,
            avg_tokens: 0,
            avg_cost_usd: 0,
            avg_duration_ms: 0,
        });

        this.register({
            id: "mmcp://pipelines/incident-response",
            name: "Incident Response Pipeline",
            version: "1.0.0",
            description: "Multi-model incident analysis with parallel classification",
            tags: ["devops", "engineering"],
            pipeline_schema: {
                entry_role: "detector",
                exit_role: "responder",
                nodes: [
                    { role: "detector", branch_type: "root", required_skills: ["classification"], optional: false },
                    { role: "analyzer", branch_type: "fork", required_skills: ["reasoning"], optional: false },
                    { role: "classifier", branch_type: "fork", required_skills: ["classification"], optional: false },
                    { role: "responder", branch_type: "merge", required_skills: ["summarization", "reasoning"], optional: false },
                ],
                max_depth: 3,
                has_parallel: true,
                has_verify: false,
                has_shard: false,
            },
            required_skills: ["reasoning", "classification", "summarization"],
            supported_vendors: ["anthropic", "openai", "google"],
            regulation_tags: [],
            created_at: new Date().toISOString(),
            run_count: 0,
            avg_tokens: 0,
            avg_cost_usd: 0,
            avg_duration_ms: 0,
        });
    }
}
