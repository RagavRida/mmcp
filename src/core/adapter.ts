import { ContextEnvelope, ModelAssignment, Message } from "../core/types";

export interface AdapterResult {
  output: string;
  tokens_used: number;
  model: string;
}

// ── Anthropic Adapter ─────────────────────────────────────────────────────────

export async function callAnthropic(
  assignment: ModelAssignment,
  context: ContextEnvelope
): Promise<AdapterResult> {
  const apiKey = assignment.api_key ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  // Build messages: if history is empty, construct from task
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
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
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

  return {
    output,
    tokens_used: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    model: data.model,
  };
}

// ── Mock Adapter (for testing without API key) ────────────────────────────────

export async function callMock(
  assignment: ModelAssignment,
  context: ContextEnvelope
): Promise<AdapterResult> {
  // Simulate latency
  await new Promise(r => setTimeout(r, 100 + Math.random() * 200));

  const mockOutputs: Record<string, string> = {
    architect: `[MOCK] Architectural plan for: ${context.task}. Subtask 1: Design. Subtask 2: Implement. Subtask 3: Verify.`,
    coder: `[MOCK] Code implementation:\n\`\`\`typescript\n// Solution for: ${context.task}\nconst solve = () => "implemented";\n\`\`\``,
    verifier: `[MOCK] Verification complete. Issues found: 1 (minor). Confidence: 0.89. The solution is largely correct.`,
    reasoner: `[MOCK] Reasoning analysis: The approach is sound. Key insight: breaking down the problem is essential here.`,
    summarizer: `[MOCK] Summary: All agents completed successfully. The final solution addresses ${context.task} effectively.`,
    challenger: `[MOCK] Challenge: The proposed solution overlooks edge cases. Specifically, error handling needs improvement.`,
    synthesizer: `[MOCK] Synthesis: After producer and challenger analysis, the balanced conclusion is: implement with added error handling.`,
  };

  return {
    output: mockOutputs[context.role] ?? `[MOCK] Output for ${context.role}: Task "${context.task}" processed.`,
    tokens_used: Math.floor(Math.random() * 500) + 100,
    model: assignment.model_id,
  };
}

// ── OpenRouter Adapter (OpenAI-compatible) ────────────────────────────────────

export async function callOpenRouter(
  assignment: ModelAssignment,
  context: ContextEnvelope
): Promise<AdapterResult> {
  const apiKey = assignment.api_key ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const endpoint = assignment.endpoint ?? "https://openrouter.ai/api/v1/chat/completions";

  const messages: Message[] =
    context.history.length > 0
      ? context.history
      : [{ role: "user", content: context.task }];

  // Prepend system prompt if provided
  const fullMessages =
    assignment.system_prompt
      ? [{ role: "system" as const, content: assignment.system_prompt }, ...messages]
      : messages;

  const body = {
    model: assignment.model_id,
    max_tokens: assignment.max_tokens ?? 4096,
    temperature: assignment.temperature ?? 0.7,
    messages: fullMessages,
  };

  const res = await fetch(endpoint, {
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
    const err = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    model: string;
  };

  const output = data.choices?.[0]?.message?.content ?? "";

  return {
    output,
    tokens_used: data.usage?.total_tokens ?? 0,
    model: data.model ?? assignment.model_id,
  };
}

// ── Adapter selector ─────────────────────────────────────────────────────────

export type AdapterType = "anthropic" | "openrouter" | "mock";

export function getAdapter(type: AdapterType) {
  if (type === "anthropic") return callAnthropic;
  if (type === "openrouter") return callOpenRouter;
  return callMock;
}
