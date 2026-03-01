// ─────────────────────────────────────────────────────────────────────────────
// MMCP Google Adapter  |  v1.0
// ─────────────────────────────────────────────────────────────────────────────

import { ContextEnvelope, ModelAssignment, Message } from "../core/types";
import { VendorAdapter, AdapterResult, MMCPAdapterError } from "./registry";

export class GoogleAdapter implements VendorAdapter {
    vendor = "google";

    call(assignment: ModelAssignment, context: ContextEnvelope): Promise<AdapterResult> {
        return callGoogleWithRetry(assignment, context);
    }

    validateConfig(): boolean {
        return !!(process.env.GOOGLE_API_KEY);
    }

    estimateCost(tokens: number): number {
        return (tokens / 1_000_000) * 3.125; // average gemini-pro-1.5
    }
}

function convertToGoogleContents(
    messages: Message[],
    systemPrompt?: string
): { contents: Array<{ role: string; parts: Array<{ text: string }> }>; systemInstruction?: { parts: Array<{ text: string }> } } {
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    for (const m of messages) {
        if (m.role === "system") continue; // handled separately
        contents.push({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
        });
    }

    const systemInstruction = systemPrompt
        ? { parts: [{ text: systemPrompt }] }
        : undefined;

    return { contents, systemInstruction };
}

async function callGoogleWithRetry(
    assignment: ModelAssignment,
    context: ContextEnvelope,
    maxRetries = 3
): Promise<AdapterResult> {
    const apiKey = assignment.api_key ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new MMCPAdapterError("GOOGLE_API_KEY not set", "google", 0);

    const messages: Message[] =
        context.history.length > 0
            ? context.history
            : [{ role: "user", content: context.task }];

    const { contents, systemInstruction } = convertToGoogleContents(messages, assignment.system_prompt);

    const body: Record<string, unknown> = {
        contents,
        generationConfig: {
            maxOutputTokens: assignment.max_tokens,
            temperature: assignment.temperature ?? 0.7,
        },
    };

    if (systemInstruction) {
        body.systemInstruction = systemInstruction;
    }

    const endpoint = assignment.endpoint ||
        `https://generativelanguage.googleapis.com/v1beta/models/${assignment.model_id}:generateContent`;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(`${endpoint}?key=${apiKey}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const errBody = await res.text();
                if ([400, 401, 403].includes(res.status)) {
                    throw new MMCPAdapterError(`Google API ${res.status}: ${errBody}`, "google", res.status);
                }
                if (res.status === 429) {
                    lastError = new MMCPAdapterError(`Google API 429: ${errBody}`, "google", 429);
                    if (attempt < maxRetries) {
                        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000 + Math.random() * 500));
                        continue;
                    }
                }
                throw new MMCPAdapterError(`Google API ${res.status}: ${errBody}`, "google", res.status);
            }

            const data = await res.json() as {
                candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
                usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
            };

            const output = data.candidates?.[0]?.content?.parts
                ?.map(p => p.text)
                ?.join("") ?? "";

            const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
            const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

            return {
                output,
                tokens_used: inputTokens + outputTokens,
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                model: assignment.model_id,
            };
        } catch (err) {
            if (err instanceof MMCPAdapterError && [400, 401, 403].includes(err.statusCode)) throw err;
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000 + Math.random() * 500));
            }
        }
    }

    throw lastError ?? new MMCPAdapterError("Google request failed after retries", "google", 0);
}
