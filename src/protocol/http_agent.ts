// ─────────────────────────────────────────────────────────────────────────────
// MMCP External Agent HTTP Protocol  |  v2.1
// Turns internal agents into external HTTP services.
// POST /mmcp/execute → intent-based task execution via any registered agent.
// ─────────────────────────────────────────────────────────────────────────────

import type { MMCPMessage, MessageIntent, MessageStatus } from "./message";
import { MMCPProtocol } from "./message";
import type { MMCPAgent } from "./agent";

// ── HTTP Protocol Types ─────────────────────────────────────────────────────

export interface AgentExecuteRequest {
    intent: MessageIntent;
    task: string;
    context: Record<string, unknown>;
    model_preference?: string;
    trace_id?: string;
    timeout_ms?: number;
    auth_token?: string;
}

export interface AgentExecuteResponse {
    status: MessageStatus;
    output: string;
    confidence: number;
    model_used: string;
    tokens_used: number;
    latency_ms: number;
    cost_usd: number;
    message: MMCPMessage;
    errors?: string[];
}

export interface AgentHealthResponse {
    agent_id: string;
    name: string;
    capabilities: string[];
    status: "healthy" | "degraded" | "down";
    uptime_ms: number;
    total_requests: number;
    success_rate: number;
}

// ── HTTP Agent Adapter ──────────────────────────────────────────────────────
// Wraps an MMCPAgent as an HTTP endpoint handler.

export class HTTPAgentAdapter {
    private agent: MMCPAgent;
    private startTime = Date.now();
    private totalRequests = 0;
    private successfulRequests = 0;

    constructor(agent: MMCPAgent) {
        this.agent = agent;
    }

    /** Handle POST /mmcp/execute — core execution endpoint. */
    async handleExecute(request: AgentExecuteRequest): Promise<AgentExecuteResponse> {
        this.totalRequests++;
        const startMs = Date.now();

        try {
            // Create MMCP protocol message from request
            const message = MMCPProtocol.createMessage({
                sender: "external_client",
                receiver: this.agent.id,
                task_id: `ext_${Date.now()}`,
                intent: request.intent,
                payload: {
                    task: request.task,
                    context: request.context,
                },
                context_id: `ctx_ext_${Date.now()}`,
                trace_id: request.trace_id,
            });

            // Execute via agent — returns MMCPMessage
            const result = await this.agent.execute(message);
            const latency_ms = Date.now() - startMs;
            this.successfulRequests++;

            // Extract result data from the response message payload
            const output = String(result.payload?.output ?? result.payload?.result ?? "");
            const model = String(result.payload?.model ?? "unknown");
            const tokens = Number(result.payload?.tokens_used ?? 0);
            const cost = Number(result.payload?.cost_usd ?? 0);

            // Build successful response
            const responseMsg = MMCPProtocol.reply(message, {
                sender: this.agent.id,
                payload: { output },
                status: "success",
                confidence: result.confidence ?? 0,
            });

            return {
                status: "success",
                output,
                confidence: result.confidence ?? 0,
                model_used: model,
                tokens_used: tokens,
                latency_ms,
                cost_usd: cost,
                message: responseMsg,
            };
        } catch (err) {
            const latency_ms = Date.now() - startMs;

            const errorMessage = MMCPProtocol.createMessage({
                sender: this.agent.id,
                receiver: "external_client",
                task_id: `ext_${Date.now()}`,
                intent: request.intent,
                payload: { error: err instanceof Error ? err.message : String(err) },
                context_id: `ctx_ext_${Date.now()}`,
                trace_id: request.trace_id,
                status: "failed",
            });

            return {
                status: "failed",
                output: "",
                confidence: 0,
                model_used: "unknown",
                tokens_used: 0,
                latency_ms,
                cost_usd: 0,
                message: errorMessage,
                errors: [err instanceof Error ? err.message : String(err)],
            };
        }
    }

    /** Handle GET /mmcp/health — health check endpoint. */
    getHealth(): AgentHealthResponse {
        return {
            agent_id: this.agent.id,
            name: this.agent.name,
            capabilities: this.agent.capabilities,
            status: "healthy",
            uptime_ms: Date.now() - this.startTime,
            total_requests: this.totalRequests,
            success_rate: this.totalRequests > 0
                ? this.successfulRequests / this.totalRequests
                : 1,
        };
    }

    /** Handle GET /mmcp/capabilities — agent capability discovery. */
    getCapabilities(): { agent_id: string; capabilities: string[] } {
        return {
            agent_id: this.agent.id,
            capabilities: this.agent.capabilities,
        };
    }
}

// ── HTTP Client (for calling remote agents) ─────────────────────────────────

export class HTTPAgentClient {
    private baseUrl: string;
    private authToken?: string;

    constructor(baseUrl: string, authToken?: string) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.authToken = authToken;
    }

    /** Call a remote MMCP agent via HTTP. */
    async execute(request: AgentExecuteRequest): Promise<AgentExecuteResponse> {
        const response = await fetch(`${this.baseUrl}/mmcp/execute`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
            },
            body: JSON.stringify(request),
            signal: request.timeout_ms
                ? AbortSignal.timeout(request.timeout_ms)
                : undefined,
        });

        if (!response.ok) {
            throw new Error(`MMCP agent error: ${response.status} ${response.statusText}`);
        }

        return response.json() as Promise<AgentExecuteResponse>;
    }

    /** Check remote agent health. */
    async health(): Promise<AgentHealthResponse> {
        const response = await fetch(`${this.baseUrl}/mmcp/health`);
        return response.json() as Promise<AgentHealthResponse>;
    }
}
