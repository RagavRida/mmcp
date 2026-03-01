// ─────────────────────────────────────────────────────────────────────────────
// MMCP OpenRouter Adapter  |  v1.0
// ─────────────────────────────────────────────────────────────────────────────

import { ContextEnvelope, ModelAssignment, Message } from "../core/types";
import { VendorAdapter, AdapterResult, MMCPAdapterError } from "./registry";

export class OpenRouterAdapter implements VendorAdapter {
    vendor = "openrouter";

    call(assignment: ModelAssignment, context: ContextEnvelope): Promise<AdapterResult> {
        return callOpenRouterWithRetry(assignment, context);
    }

    validateConfig(): boolean {
        return !!(process.env.OPENROUTER_API_KEY);
    }

    estimateCost(tokens: number): number {
        return (tokens / 1_000_000) * 5; // rough estimate
    }
}

async function callOpenRouterWithRetry(
    assignment: ModelAssignment,
    context: ContextEnvelope,
    maxRetries = 3
): Promise<AdapterResult> {
    const apiKey = assignment.api_key ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new MMCPAdapterError("OPENROUTER_API_KEY not set", "openrouter", 0);

    const chatMessages: Array<{ role: string; content: string }> = [];

    if (assignment.system_prompt) {
        chatMessages.push({ role: "system", content: assignment.system_prompt });
    }

    const messages: Message[] =
        context.history.length > 0
            ? context.history
            : [{ role: "user", content: context.task }];

    for (const m of messages) {
        chatMessages.push({ role: m.role, content: m.content });
    }

    const body = {
        model: assignment.model_id,
        max_tokens: assignment.max_tokens ?? 4096,
        temperature: assignment.temperature ?? 0.7,
        messages: chatMessages,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(assignment.endpoint || "https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                    "HTTP-Referer": "https://mmcp.dev",
                    "X-Title": "MMCP Orchestrator",
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errBody = await res.text();
                if ([400, 401, 403].includes(res.status)) {
                    throw new MMCPAdapterError(`OpenRouter API ${res.status}: ${errBody}`, "openrouter", res.status);
                }
                if (res.status === 429) {
                    lastError = new MMCPAdapterError(`OpenRouter API 429: ${errBody}`, "openrouter", 429);
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000 + Math.random() * 500));
                        continue;
                    }
                }
                throw new MMCPAdapterError(`OpenRouter API ${res.status}: ${errBody}`, "openrouter", res.status);
            }

            const data = await res.json() as {
                choices: Array<{ message: { content: string } }>;
                usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
                model: string;
            };

            const output = data.choices?.[0]?.message?.content ?? "";
            const inputTokens = data.usage?.prompt_tokens ?? 0;
            const outputTokens = data.usage?.completion_tokens ?? 0;

            return {
                output,
                tokens_used: inputTokens + outputTokens,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                model: data.model ?? assignment.model_id,
            };
        } catch (err) {
            if (err instanceof MMCPAdapterError && [400, 401, 403].includes(err.statusCode)) throw err;
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000 + Math.random() * 500));
            }
        }
    }

    throw lastError ?? new MMCPAdapterError("OpenRouter request failed after retries", "openrouter", 0);
}
