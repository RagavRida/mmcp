// ─────────────────────────────────────────────────────────────────────────────
// MMCP OpenAI Adapter  |  v1.0
// ─────────────────────────────────────────────────────────────────────────────

import { ContextEnvelope, ModelAssignment, Message } from "../core/types";
import { VendorAdapter, AdapterResult, MMCPAdapterError } from "./registry";

export class OpenAIAdapter implements VendorAdapter {
    vendor = "openai";

    call(assignment: ModelAssignment, context: ContextEnvelope): Promise<AdapterResult> {
        return callOpenAIWithRetry(assignment, context);
    }

    validateConfig(): boolean {
        return !!(process.env.OPENAI_API_KEY);
    }

    estimateCost(tokens: number): number {
        return (tokens / 1_000_000) * 6.25; // average gpt-4o
    }
}

async function callOpenAIWithRetry(
    assignment: ModelAssignment,
    context: ContextEnvelope,
    maxRetries = 3
): Promise<AdapterResult> {
    const apiKey = assignment.api_key ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new MMCPAdapterError("OPENAI_API_KEY not set", "openai", 0);

    // Convert MMCP history to OpenAI chat format
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
        max_tokens: assignment.max_tokens,
        temperature: assignment.temperature ?? 0.7,
        messages: chatMessages,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(assignment.endpoint || "https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errBody = await res.text();
                if ([400, 401, 403].includes(res.status)) {
                    throw new MMCPAdapterError(`OpenAI API ${res.status}: ${errBody}`, "openai", res.status);
                }
                if (res.status === 429) {
                    lastError = new MMCPAdapterError(`OpenAI API 429: ${errBody}`, "openai", 429);
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000 + Math.random() * 500));
                        continue;
                    }
                }
                throw new MMCPAdapterError(`OpenAI API ${res.status}: ${errBody}`, "openai", res.status);
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

    throw lastError ?? new MMCPAdapterError("OpenAI request failed after retries", "openai", 0);
}
