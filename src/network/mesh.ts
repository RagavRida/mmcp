// ─────────────────────────────────────────────────────────────────────────────
// MMCP Network Mesh  |  v2.1  —  Multi-Node Agent Communication
// "Internet of AI Agents" — discover, connect, and route tasks across
// geographically distributed agent nodes via the MMCP protocol.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from "uuid";
import type { MMCPMessage, MessageIntent } from "../protocol/message";
import { MMCPProtocol } from "../protocol/message";

// ── Types ────────────────────────────────────────────────────────────────────

export type NodeStatus = "online" | "offline" | "degraded";

export interface NetworkNode {
    node_id: string;
    name: string;
    region: string;                     // e.g. "us-east", "eu-west", "ap-south"
    endpoint: string;                   // HTTP endpoint for this node
    capabilities: string[];             // what this node can do
    status: NodeStatus;
    latency_ms: number;                 // avg latency from mesh coordinator
    load: number;                       // 0.0–1.0 current load factor
    last_heartbeat: string;             // ISO 8601
    metadata: Record<string, unknown>;
}

export interface RouteDecision {
    target_node: NetworkNode;
    reason: string;
    alternatives: NetworkNode[];
    estimated_latency_ms: number;
}

export interface NetworkStats {
    total_nodes: number;
    online_nodes: number;
    total_messages_routed: number;
    avg_latency_ms: number;
    messages_by_region: Record<string, number>;
}

// ── Routing Strategies ──────────────────────────────────────────────────────

export type NetworkRoutingStrategy = "nearest" | "least_loaded" | "capability_match" | "round_robin";

// ── MMCP Network Mesh ───────────────────────────────────────────────────────

export class MMCPNetworkMesh {
    private nodes = new Map<string, NetworkNode>();
    private messageLog: Array<{ message_id: string; source: string; target: string; timestamp: string }> = [];
    private strategy: NetworkRoutingStrategy;
    private roundRobinIndex = 0;
    private localNodeId: string;

    constructor(localNodeId: string, strategy: NetworkRoutingStrategy = "capability_match") {
        this.localNodeId = localNodeId;
        this.strategy = strategy;
    }

    // ── Node Management ─────────────────────────────────────────────────────

    /** Register a network node. */
    registerNode(node: Omit<NetworkNode, "node_id" | "last_heartbeat">): NetworkNode {
        const fullNode: NetworkNode = {
            ...node,
            node_id: `node_${uuidv4().replace(/-/g, "").slice(0, 12)}`,
            last_heartbeat: new Date().toISOString(),
        };
        this.nodes.set(fullNode.node_id, fullNode);
        return fullNode;
    }

    /** Register with a known node_id. */
    addNode(node: NetworkNode): void {
        this.nodes.set(node.node_id, node);
    }

    /** Remove a node from the mesh. */
    removeNode(node_id: string): boolean {
        return this.nodes.delete(node_id);
    }

    /** Update a node's heartbeat and status. */
    heartbeat(node_id: string, status: NodeStatus = "online", load?: number): void {
        const node = this.nodes.get(node_id);
        if (!node) return;
        node.status = status;
        node.last_heartbeat = new Date().toISOString();
        if (load !== undefined) node.load = load;
    }

    /** Get all online nodes. */
    getOnlineNodes(): NetworkNode[] {
        return Array.from(this.nodes.values()).filter(n => n.status === "online");
    }

    /** Get a node by ID. */
    getNode(node_id: string): NetworkNode | null {
        return this.nodes.get(node_id) ?? null;
    }

    // ── Discovery ───────────────────────────────────────────────────────────

    /** Discover nodes that have a specific capability. */
    discoverByCapability(capability: string): NetworkNode[] {
        return this.getOnlineNodes().filter(n =>
            n.capabilities.includes(capability)
        );
    }

    /** Discover nodes in a specific region. */
    discoverByRegion(region: string): NetworkNode[] {
        return this.getOnlineNodes().filter(n => n.region === region);
    }

    /** Find the nearest online node by latency. */
    findNearest(): NetworkNode | null {
        const online = this.getOnlineNodes();
        if (online.length === 0) return null;
        return online.sort((a, b) => a.latency_ms - b.latency_ms)[0];
    }

    // ── Routing ─────────────────────────────────────────────────────────────

    /** Route a task to the best node based on strategy. */
    route(intent: MessageIntent, requiredCapabilities: string[] = []): RouteDecision | null {
        const candidates = requiredCapabilities.length > 0
            ? this.getOnlineNodes().filter(n =>
                requiredCapabilities.some(cap => n.capabilities.includes(cap))
              )
            : this.getOnlineNodes();

        if (candidates.length === 0) return null;

        let target: NetworkNode;
        let reason: string;

        switch (this.strategy) {
            case "nearest":
                target = candidates.sort((a, b) => a.latency_ms - b.latency_ms)[0];
                reason = `nearest node (${target.latency_ms}ms latency)`;
                break;

            case "least_loaded":
                target = candidates.sort((a, b) => a.load - b.load)[0];
                reason = `least loaded (${(target.load * 100).toFixed(0)}% load)`;
                break;

            case "round_robin":
                this.roundRobinIndex = this.roundRobinIndex % candidates.length;
                target = candidates[this.roundRobinIndex];
                this.roundRobinIndex++;
                reason = `round robin (index ${this.roundRobinIndex - 1})`;
                break;

            case "capability_match":
            default: {
                // Score by: capability coverage × (1 - load) / latency
                const scored = candidates.map(n => {
                    const capScore = requiredCapabilities.length > 0
                        ? requiredCapabilities.filter(c => n.capabilities.includes(c)).length / requiredCapabilities.length
                        : 1;
                    const loadFactor = 1 - n.load;
                    const latencyFactor = 1 / (1 + n.latency_ms / 1000);
                    return { node: n, score: capScore * loadFactor * latencyFactor };
                }).sort((a, b) => b.score - a.score);

                target = scored[0].node;
                reason = `capability match (score: ${scored[0].score.toFixed(3)})`;
                break;
            }
        }

        return {
            target_node: target,
            reason,
            alternatives: candidates.filter(n => n.node_id !== target.node_id).slice(0, 3),
            estimated_latency_ms: target.latency_ms,
        };
    }

    /** Create a protocol message for cross-node communication. */
    createNetworkMessage(
        target_node_id: string,
        intent: MessageIntent,
        task: string,
        payload: Record<string, unknown> = {}
    ): MMCPMessage {
        const msg = MMCPProtocol.createMessage({
            sender: this.localNodeId,
            receiver: target_node_id,
            task_id: `net_${Date.now()}`,
            intent,
            payload: { ...payload, task, network_hop: true },
            context_id: `ctx_net_${Date.now()}`,
        });

        this.messageLog.push({
            message_id: msg.message_id,
            source: this.localNodeId,
            target: target_node_id,
            timestamp: msg.timestamp,
        });

        return msg;
    }

    // ── Stats ───────────────────────────────────────────────────────────────

    /** Get network statistics. */
    getStats(): NetworkStats {
        const allNodes = Array.from(this.nodes.values());
        const online = allNodes.filter(n => n.status === "online");

        const regionCounts: Record<string, number> = {};
        for (const entry of this.messageLog) {
            const targetNode = this.nodes.get(entry.target);
            if (targetNode) {
                regionCounts[targetNode.region] = (regionCounts[targetNode.region] ?? 0) + 1;
            }
        }

        return {
            total_nodes: allNodes.length,
            online_nodes: online.length,
            total_messages_routed: this.messageLog.length,
            avg_latency_ms: online.length > 0
                ? online.reduce((s, n) => s + n.latency_ms, 0) / online.length
                : 0,
            messages_by_region: regionCounts,
        };
    }

    /** Total number of nodes in the mesh. */
    get size(): number {
        return this.nodes.size;
    }

    /** Clear all nodes and logs. */
    clear(): void {
        this.nodes.clear();
        this.messageLog = [];
    }
}
