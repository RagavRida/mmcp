// ─────────────────────────────────────────────────────────────────────────────
// MMCP External Agent Support  |  v2.0
// Plugin interface for custom executors, verifiers, and external agents.
// ─────────────────────────────────────────────────────────────────────────────

import { MMCPMessage } from "./message";

// ── Agent Interface ──────────────────────────────────────────────────────────

export interface MMCPAgent {
    /** Unique agent identifier. */
    id: string;
    /** Human-readable agent name. */
    name: string;
    /** Skills/capabilities this agent provides. */
    capabilities: string[];
    /** Description of what this agent does. */
    description?: string;
    /** Process a protocol message and return a response. */
    execute(message: MMCPMessage): Promise<MMCPMessage>;
}

// ── Agent Registry ───────────────────────────────────────────────────────────

export class AgentRegistry {
    private agents = new Map<string, MMCPAgent>();

    /** Register an external agent. */
    register(agent: MMCPAgent): void {
        if (this.agents.has(agent.id)) {
            throw new Error(`Agent already registered: ${agent.id}`);
        }
        this.agents.set(agent.id, agent);
    }

    /** Unregister an agent by ID. */
    unregister(id: string): boolean {
        return this.agents.delete(id);
    }

    /** Get an agent by ID. */
    get(id: string): MMCPAgent | null {
        return this.agents.get(id) ?? null;
    }

    /** Find agents that have ANY of the requested capabilities. */
    findByCapabilities(capabilities: string[]): MMCPAgent[] {
        return Array.from(this.agents.values()).filter(agent =>
            capabilities.some(cap => agent.capabilities.includes(cap))
        );
    }

    /** Find the best agent for a set of capabilities (most matching skills). */
    findBest(capabilities: string[]): MMCPAgent | null {
        const agents = Array.from(this.agents.values());
        if (agents.length === 0) return null;

        let best: MMCPAgent | null = null;
        let bestScore = 0;

        for (const agent of agents) {
            const score = capabilities.filter(cap =>
                agent.capabilities.includes(cap)
            ).length;
            if (score > bestScore) {
                bestScore = score;
                best = agent;
            }
        }

        return best;
    }

    /** List all registered agents. */
    list(): MMCPAgent[] {
        return Array.from(this.agents.values());
    }

    /** Number of registered agents. */
    get size(): number {
        return this.agents.size;
    }

    /** Clear all agents. */
    clear(): void {
        this.agents.clear();
    }
}
