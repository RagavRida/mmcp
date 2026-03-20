// ─────────────────────────────────────────────────────────────────────────────
// MMCP Execution Persistence  |  v2.1  —  Checkpoint & Recovery
// Serializes execution state for crash recovery and distributed execution.
// ─────────────────────────────────────────────────────────────────────────────

import { ExecutionStateMachine, ExecutionState, StateTransition } from "./state_machine";

// ── Checkpoint ───────────────────────────────────────────────────────────────

export interface ExecutionCheckpoint {
    checkpoint_id: string;
    ctx_id: string;
    state: ExecutionState;
    history: StateTransition[];
    metadata: Record<string, unknown>;
    created_at: string;
    // Pipeline progress
    completed_node_ids: string[];
    pending_node_ids: string[];
    shared_context_snapshot: Record<string, unknown>;
}

// ── Persistence Store ────────────────────────────────────────────────────────

export class ExecutionPersistence {
    private checkpoints = new Map<string, ExecutionCheckpoint[]>();  // ctx_id → checkpoints

    /** Save a checkpoint for the given state machine. */
    checkpoint(
        sm: ExecutionStateMachine,
        ctx_id: string,
        data: {
            completed_node_ids?: string[];
            pending_node_ids?: string[];
            shared_context_snapshot?: Record<string, unknown>;
            metadata?: Record<string, unknown>;
        } = {}
    ): ExecutionCheckpoint {
        const cp: ExecutionCheckpoint = {
            checkpoint_id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            ctx_id,
            state: sm.getCurrentState(),
            history: sm.getHistory(),
            metadata: data.metadata ?? {},
            created_at: new Date().toISOString(),
            completed_node_ids: data.completed_node_ids ?? [],
            pending_node_ids: data.pending_node_ids ?? [],
            shared_context_snapshot: data.shared_context_snapshot ?? {},
        };

        const existing = this.checkpoints.get(ctx_id) ?? [];
        existing.push(cp);
        this.checkpoints.set(ctx_id, existing);

        return cp;
    }

    /** Restore a state machine from the latest checkpoint. */
    restore(ctx_id: string): {
        sm: ExecutionStateMachine;
        checkpoint: ExecutionCheckpoint;
    } | null {
        const checkpoints = this.checkpoints.get(ctx_id);
        if (!checkpoints || checkpoints.length === 0) return null;

        const latest = checkpoints[checkpoints.length - 1];
        const sm = new ExecutionStateMachine(latest.state, ctx_id);

        return { sm, checkpoint: latest };
    }

    /** Get all checkpoints for a context. */
    getCheckpoints(ctx_id: string): ExecutionCheckpoint[] {
        return this.checkpoints.get(ctx_id) ?? [];
    }

    /** Get the latest checkpoint. */
    getLatest(ctx_id: string): ExecutionCheckpoint | null {
        const cps = this.checkpoints.get(ctx_id);
        if (!cps || cps.length === 0) return null;
        return cps[cps.length - 1];
    }

    /** Serialize all checkpoints to JSON (for file/DB storage). */
    serialize(): string {
        const data: Record<string, ExecutionCheckpoint[]> = {};
        for (const [key, value] of this.checkpoints) {
            data[key] = value;
        }
        return JSON.stringify(data, null, 2);
    }

    /** Restore from serialized JSON. */
    deserialize(json: string): void {
        const data = JSON.parse(json) as Record<string, ExecutionCheckpoint[]>;
        this.checkpoints.clear();
        for (const [key, value] of Object.entries(data)) {
            this.checkpoints.set(key, value);
        }
    }

    /** Total checkpoints stored. */
    get size(): number {
        let total = 0;
        for (const cps of this.checkpoints.values()) {
            total += cps.length;
        }
        return total;
    }

    /** Clear all checkpoints. */
    clear(): void {
        this.checkpoints.clear();
    }
}
