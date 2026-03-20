// ─────────────────────────────────────────────────────────────────────────────
// MMCP Context Engine  |  v2.1  —  Structured Task Memory + Semantic Search
// Tracks tasks, sessions, steps, confidence, and enables learning/reuse
// across pipeline executions via context_refs and embedding vectors.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from "uuid";
import { ExecutionState } from "./state_machine";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StepRecord {
    step_id: string;
    agent: string;                     // role
    ctx_id: string;                    // links to ContextEnvelope.id
    input: string;
    output: string;
    model: string;
    latency_ms: number;
    tokens_used: number;
    cost_usd: number;
    confidence?: number;
    embedding_vector?: number[];       // ← semantic embedding for this step
    timestamp: string;
}

export interface TaskRecord {
    task_id: string;
    session_id: string;
    context_refs: string[];            // cross-task linking
    steps: StepRecord[];
    description: string;               // task description / prompt
    final_output: string;
    confidence: number;
    status: ExecutionState;
    total_tokens: number;
    total_cost_usd: number;
    total_latency_ms: number;
    embedding_vector?: number[];       // ← semantic embedding for this task
    created_at: string;
    completed_at?: string;
    metadata: Record<string, unknown>;
}

// ── Context Engine ───────────────────────────────────────────────────────────

export class ContextEngine {
    private tasks = new Map<string, TaskRecord>();
    private sessionIndex = new Map<string, string[]>();   // session_id → task_ids

    // ── Task Lifecycle ──────────────────────────────────────────────────────

    /** Create a new task record. Returns the task_id. */
    createTask(
        session_id: string,
        description: string,
        context_refs: string[] = [],
        metadata: Record<string, unknown> = {}
    ): TaskRecord {
        const task_id = `task_${uuidv4().replace(/-/g, "")}`;
        const task: TaskRecord = {
            task_id,
            session_id,
            context_refs,
            steps: [],
            description,
            final_output: "",
            confidence: 0,
            status: "INIT",
            total_tokens: 0,
            total_cost_usd: 0,
            total_latency_ms: 0,
            created_at: new Date().toISOString(),
            metadata,
        };

        this.tasks.set(task_id, task);

        // Index by session
        const sessionTasks = this.sessionIndex.get(session_id) ?? [];
        sessionTasks.push(task_id);
        this.sessionIndex.set(session_id, sessionTasks);

        return task;
    }

    /** Record a step (node execution) within a task. */
    recordStep(task_id: string, step: Omit<StepRecord, "step_id" | "timestamp">): StepRecord {
        const task = this.tasks.get(task_id);
        if (!task) throw new Error(`Task not found: ${task_id}`);

        const record: StepRecord = {
            ...step,
            step_id: `step_${uuidv4().replace(/-/g, "").slice(0, 12)}`,
            timestamp: new Date().toISOString(),
        };

        task.steps.push(record);
        task.total_tokens += step.tokens_used;
        task.total_cost_usd += step.cost_usd;
        task.total_latency_ms += step.latency_ms;

        return record;
    }

    /** Mark task as completed with final output and confidence. */
    completeTask(task_id: string, output: string, confidence: number): TaskRecord {
        const task = this.tasks.get(task_id);
        if (!task) throw new Error(`Task not found: ${task_id}`);

        task.final_output = output;
        task.confidence = confidence;
        task.status = "DONE";
        task.completed_at = new Date().toISOString();

        return task;
    }

    /** Mark task as failed. */
    failTask(task_id: string, reason: string): TaskRecord {
        const task = this.tasks.get(task_id);
        if (!task) throw new Error(`Task not found: ${task_id}`);

        task.status = "FAILED";
        task.completed_at = new Date().toISOString();
        task.metadata.failure_reason = reason;

        return task;
    }

    /** Update task status. */
    updateStatus(task_id: string, status: ExecutionState): void {
        const task = this.tasks.get(task_id);
        if (!task) throw new Error(`Task not found: ${task_id}`);
        task.status = status;
    }

    // ── Cross-Task Memory ───────────────────────────────────────────────────

    /** Get all tasks linked via context_refs to a given task. */
    getLinkedTasks(task_id: string): TaskRecord[] {
        const task = this.tasks.get(task_id);
        if (!task) return [];

        const linked: TaskRecord[] = [];
        for (const ref of task.context_refs) {
            const refTask = this.tasks.get(ref);
            if (refTask) linked.push(refTask);
        }
        return linked;
    }

    /** Add a context reference link between tasks. */
    linkTask(task_id: string, ref_task_id: string): void {
        const task = this.tasks.get(task_id);
        if (!task) throw new Error(`Task not found: ${task_id}`);
        if (!task.context_refs.includes(ref_task_id)) {
            task.context_refs.push(ref_task_id);
        }
    }

    /** Simple keyword search across task descriptions and outputs. */
    findSimilarTasks(query: string, limit: number = 10): TaskRecord[] {
        const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
        if (keywords.length === 0) return [];

        const scored: Array<{ task: TaskRecord; score: number }> = [];

        for (const task of this.tasks.values()) {
            const text = `${task.description} ${task.final_output}`.toLowerCase();
            let score = 0;
            for (const kw of keywords) {
                if (text.includes(kw)) score++;
            }
            if (score > 0) {
                scored.push({ task, score });
            }
        }

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(s => s.task);
    }

    // ── Queries ──────────────────────────────────────────────────────────────

    /** Get a single task by ID. */
    getTask(task_id: string): TaskRecord | null {
        return this.tasks.get(task_id) ?? null;
    }

    /** Get all tasks for a session, ordered by creation time. */
    getSession(session_id: string): TaskRecord[] {
        const taskIds = this.sessionIndex.get(session_id) ?? [];
        return taskIds
            .map(id => this.tasks.get(id)!)
            .filter(Boolean)
            .sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    /** List tasks with optional filtering. */
    listTasks(filter?: {
        session_id?: string;
        status?: ExecutionState;
        limit?: number;
    }): TaskRecord[] {
        let results = Array.from(this.tasks.values());

        if (filter?.session_id) {
            results = results.filter(t => t.session_id === filter.session_id);
        }
        if (filter?.status) {
            results = results.filter(t => t.status === filter.status);
        }

        results.sort((a, b) => b.created_at.localeCompare(a.created_at)); // newest first

        if (filter?.limit) {
            results = results.slice(0, filter.limit);
        }

        return results;
    }

    /** Total number of tasks tracked. */
    get size(): number {
        return this.tasks.size;
    }

    /** Clear all tasks and session indices. */
    clear(): void {
        this.tasks.clear();
        this.sessionIndex.clear();
    }

    // ── Semantic Memory ─────────────────────────────────────────────────────

    /** Set the embedding vector for a task (call after generating via external model). */
    setTaskEmbedding(task_id: string, vector: number[]): void {
        const task = this.tasks.get(task_id);
        if (!task) throw new Error(`Task not found: ${task_id}`);
        task.embedding_vector = vector;
    }

    /** Find tasks by cosine similarity to a query embedding. */
    findByEmbedding(queryVector: number[], limit: number = 5, threshold: number = 0.5): Array<{ task: TaskRecord; similarity: number }> {
        const results: Array<{ task: TaskRecord; similarity: number }> = [];

        for (const task of this.tasks.values()) {
            if (!task.embedding_vector) continue;
            const sim = ContextEngine.cosineSimilarity(queryVector, task.embedding_vector);
            if (sim >= threshold) {
                results.push({ task, similarity: sim });
            }
        }

        return results
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }

    /** Cosine similarity between two vectors. */
    static cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length || a.length === 0) return 0;
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        const denom = Math.sqrt(magA) * Math.sqrt(magB);
        return denom === 0 ? 0 : dot / denom;
    }
}
