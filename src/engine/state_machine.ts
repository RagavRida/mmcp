// ─────────────────────────────────────────────────────────────────────────────
// MMCP Execution State Machine  |  v2.0
// Explicit state transitions for reliable retries, distributed execution,
// and scaling. Every context node runs through this state machine.
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutionState =
    | "INIT"
    | "PLANNED"
    | "EXECUTING"
    | "VERIFYING"
    | "DONE"
    | "FAILED";

export interface StateTransition {
    from: ExecutionState;
    to: ExecutionState;
    timestamp: string;
    reason?: string;
    ctx_id?: string;
}

// Valid transition map — key is the "from" state, values are allowed "to" states
const VALID_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
    INIT: ["PLANNED", "EXECUTING", "FAILED"],
    PLANNED: ["EXECUTING", "FAILED"],
    EXECUTING: ["VERIFYING", "DONE", "FAILED"],
    VERIFYING: ["DONE", "FAILED", "EXECUTING"],   // EXECUTING = retry after verify fail
    DONE: [],                                       // terminal
    FAILED: ["INIT", "EXECUTING"],                  // retry from failure
};

export class ExecutionStateMachine {
    private state: ExecutionState = "INIT";
    private transitions: StateTransition[] = [];

    constructor(
        initialState: ExecutionState = "INIT",
        private ctx_id?: string
    ) {
        this.state = initialState;
    }

    /** Current state. */
    getCurrentState(): ExecutionState {
        return this.state;
    }

    /** Check whether a transition to `to` is allowed from current state. */
    canTransition(to: ExecutionState): boolean {
        return VALID_TRANSITIONS[this.state].includes(to);
    }

    /** Get all states reachable from the current state. */
    allowedTransitions(): ExecutionState[] {
        return [...VALID_TRANSITIONS[this.state]];
    }

    /**
     * Attempt a state transition. Returns the transition record on success.
     * Throws if the transition is not valid from the current state.
     */
    transition(to: ExecutionState, reason?: string): StateTransition {
        if (!this.canTransition(to)) {
            throw new Error(
                `Invalid state transition: ${this.state} → ${to}. ` +
                `Allowed from ${this.state}: [${VALID_TRANSITIONS[this.state].join(", ")}]` +
                (this.ctx_id ? ` (ctx: ${this.ctx_id})` : "")
            );
        }

        const record: StateTransition = {
            from: this.state,
            to,
            timestamp: new Date().toISOString(),
            reason,
            ctx_id: this.ctx_id,
        };

        this.state = to;
        this.transitions.push(record);
        return record;
    }

    /** Full transition history (oldest first). */
    getHistory(): StateTransition[] {
        return [...this.transitions];
    }

    /** True if the state machine is in a terminal state (DONE or FAILED with no retries). */
    isTerminal(): boolean {
        return this.state === "DONE" ||
            (this.state === "FAILED" && VALID_TRANSITIONS["FAILED"].length === 0);
    }

    /** Reset state machine to INIT. Used for full retry / re-planning. */
    reset(reason?: string): StateTransition {
        const record: StateTransition = {
            from: this.state,
            to: "INIT",
            timestamp: new Date().toISOString(),
            reason: reason ?? "reset",
            ctx_id: this.ctx_id,
        };
        this.state = "INIT";
        this.transitions.push(record);
        return record;
    }

    /** Map ExecutionState → legacy ContextStatus for backward compatibility. */
    static toLegacyStatus(state: ExecutionState): "pending" | "running" | "done" | "failed" | "skipped" {
        switch (state) {
            case "INIT":
            case "PLANNED":
                return "pending";
            case "EXECUTING":
            case "VERIFYING":
                return "running";
            case "DONE":
                return "done";
            case "FAILED":
                return "failed";
        }
    }

    /** Map legacy ContextStatus → closest ExecutionState. */
    static fromLegacyStatus(status: "pending" | "running" | "done" | "failed" | "skipped"): ExecutionState {
        switch (status) {
            case "pending":
                return "INIT";
            case "running":
                return "EXECUTING";
            case "done":
                return "DONE";
            case "failed":
            case "skipped":
                return "FAILED";
        }
    }
}
