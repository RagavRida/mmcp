// ─────────────────────────────────────────────────────────────────────────────
// MMCP Anthropic Adapter  |  v1.0
// ─────────────────────────────────────────────────────────────────────────────

import { ContextEnvelope, ModelAssignment, Message } from "../core/types";
import { VendorAdapter, AdapterResult, MMCPAdapterError } from "./registry";

export class AnthropicAdapter implements VendorAdapter {
    vendor = "anthropic";

    call(assignment: ModelAssignment, context: ContextEnvelope): Promise<AdapterResult> {
        return callAnthropicWithRetry(assignment, context);
    }

    validateConfig(): boolean {
        return !!(process.env.ANTHROPIC_API_KEY);
    }

    estimateCost(tokens: number): number {
        // rough estimate using sonnet pricing
        return (tokens / 1_000_000) * 9; // average of input/output
    }
}

// Statuses that should NOT be retried
const NON_RETRYABLE = new Set([400, 401, 403, 404]);

async function callAnthropicWithRetry(
    assignment: ModelAssignment,
    context: ContextEnvelope,
    maxRetries = 3
): Promise<AdapterResult> {
    const apiKey = assignment.api_key ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new MMCPAdapterError("ANTHROPIC_API_KEY not set", "anthropic", 0);

    const messages: Message[] =
        context.history.length > 0
            ? context.history
            : [{ role: "user", content: context.task }];

    const body = {
        model: assignment.model_id,
        max_tokens: assignment.max_tokens,
        system: assignment.system_prompt,
        messages,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(assignment.endpoint || "https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errBody = await res.text();

                // Non-retryable errors → throw immediately
                if (NON_RETRYABLE.has(res.status)) {
                    throw new MMCPAdapterError(
                        `Anthropic API ${res.status}: ${errBody}`,
                        "anthropic",
                        res.status
                    );
                }

                // 429 (rate limit) or 529 (overloaded) → retry with backoff
                if (res.status === 429 || res.status === 529) {
                    lastError = new MMCPAdapterError(
                        `Anthropic API ${res.status}: ${errBody}`,
                        "anthropic",
                        res.status
                    );
                    if (attempt < maxRetries) {
                        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
                        await new Promise(r => setTimeout(r, delay));
                        continue;
                    }
                }

                throw new MMCPAdapterError(
                    `Anthropic API ${res.status}: ${errBody}`,
                    "anthropic",
                    res.status
                );
            }

            const data = await res.json() as {
                content: Array<{ type: string; text: string }>;
                usage: { input_tokens: number; output_tokens: number };
                model: string;
            };

            const output = data.content
                .filter(b => b.type === "text")
                .map(b => b.text)
                .join("");

            const inputTokens = data.usage?.input_tokens ?? 0;
            const outputTokens = data.usage?.output_tokens ?? 0;

            return {
                output,
                tokens_used: inputTokens + outputTokens,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                model: data.model,
            };

        } catch (err) {
            if (err instanceof MMCPAdapterError && NON_RETRYABLE.has(err.statusCode)) {
                throw err;
            }
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }

    throw lastError ?? new MMCPAdapterError("Anthropic request failed after retries", "anthropic", 0);
}
