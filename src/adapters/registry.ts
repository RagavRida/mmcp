// ─────────────────────────────────────────────────────────────────────────────
// MMCP Adapter Registry  |  v1.0  —  VendorAdapter interface + registry
// ─────────────────────────────────────────────────────────────────────────────

import { ContextEnvelope, ModelAssignment } from "../core/types";

// ── Adapter Result ───────────────────────────────────────────────────────────

export interface AdapterResult {
    output: string;
    tokens_used: number;
    input_tokens: number;
    output_tokens: number;
    model: string;
}

// ── Vendor Adapter Interface ─────────────────────────────────────────────────

export interface VendorAdapter {
    vendor: string;
    call(assignment: ModelAssignment, context: ContextEnvelope): Promise<AdapterResult>;
    validateConfig(): boolean;
    estimateCost(tokens: number): number;
}

// ── Adapter Error ────────────────────────────────────────────────────────────

export class MMCPAdapterError extends Error {
    constructor(
        message: string,
        public readonly vendor: string,
        public readonly statusCode: number
    ) {
        super(`MMCPAdapterError [${vendor}] (${statusCode}): ${message}`);
        this.name = "MMCPAdapterError";
    }
}

// ── Adapter Registry ─────────────────────────────────────────────────────────

export class AdapterRegistry {
    private adapters = new Map<string, VendorAdapter>();

    registerAdapter(vendor: string, adapter: VendorAdapter): void {
        this.adapters.set(vendor, adapter);
    }

    getAdapter(vendor: string): VendorAdapter {
        const adapter = this.adapters.get(vendor);
        if (!adapter) throw new Error(`No adapter registered for vendor: ${vendor}`);
        return adapter;
    }

    getAdapterForModel(modelId: string): VendorAdapter {
        const vendor = AdapterRegistry.detectVendor(modelId);
        return this.getAdapter(vendor);
    }

    listVendors(): string[] {
        return Array.from(this.adapters.keys());
    }

    // Auto-detect vendor from model ID prefix
    static detectVendor(modelId: string): string {
        if (/^claude-/.test(modelId)) return "anthropic";
        if (/^(gpt-|o1-|o3-)/.test(modelId)) return "openai";
        if (/^gemini-/.test(modelId)) return "google";
        return "openrouter"; // fallback
    }
}
