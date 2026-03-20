// ─────────────────────────────────────────────────────────────────────────────
// MMCP Benchmark Suite  |  v2.1
// Compare MMCP multi-model pipelines vs single-model baselines.
// Measures cost, latency, accuracy, and token efficiency.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export interface BenchmarkTask {
    id: string;
    description: string;
    intent: string;
    expected_keywords?: string[];       // keywords that should appear in output
    expected_format?: "json" | "text" | "code";
    difficulty: "easy" | "medium" | "hard";
}

export interface BenchmarkRun {
    task_id: string;
    system: string;                     // "mmcp" | "single-model" | "langchain" | "autogen"
    model: string;
    output: string;
    tokens_used: number;
    cost_usd: number;
    latency_ms: number;
    accuracy_score: number;             // 0.0–1.0
    passed: boolean;
}

export interface BenchmarkComparison {
    task_id: string;
    task_description: string;
    runs: BenchmarkRun[];
    winner: string;                     // system name
    winner_reason: string;
}

export interface BenchmarkReport {
    total_tasks: number;
    total_runs: number;
    comparisons: BenchmarkComparison[];
    summary: Record<string, SystemSummary>;
    winner: string;
    winner_reason: string;
}

export interface SystemSummary {
    system: string;
    total_runs: number;
    avg_accuracy: number;
    avg_latency_ms: number;
    avg_cost_usd: number;
    avg_tokens: number;
    total_cost_usd: number;
    wins: number;
    composite_score: number;            // weighted score
}

// ── Benchmark Suite ─────────────────────────────────────────────────────────

export class MMCPBenchmarkSuite {
    private tasks: BenchmarkTask[] = [];
    private runs: BenchmarkRun[] = [];
    private weights = { accuracy: 0.5, latency: 0.2, cost: 0.3 };

    constructor(weights?: { accuracy?: number; latency?: number; cost?: number }) {
        if (weights) {
            this.weights = {
                accuracy: weights.accuracy ?? 0.5,
                latency: weights.latency ?? 0.2,
                cost: weights.cost ?? 0.3,
            };
        }
    }

    // ── Task Management ─────────────────────────────────────────────────────

    /** Register a benchmark task. */
    addTask(task: BenchmarkTask): void {
        this.tasks.push(task);
    }

    /** Add a set of standard benchmark tasks. */
    addStandardTasks(): void {
        const tasks: BenchmarkTask[] = [
            {
                id: "bench_code_gen",
                description: "Write a Python function to find the nth Fibonacci number",
                intent: "code_generation",
                expected_keywords: ["def", "fibonacci", "return"],
                expected_format: "code",
                difficulty: "easy",
            },
            {
                id: "bench_analysis",
                description: "Analyze the pros and cons of microservices vs monolith",
                intent: "analysis",
                expected_keywords: ["microservices", "monolith", "scaling"],
                expected_format: "text",
                difficulty: "medium",
            },
            {
                id: "bench_review",
                description: "Review this code for security issues: eval(user_input)",
                intent: "review",
                expected_keywords: ["security", "eval", "injection"],
                expected_format: "text",
                difficulty: "easy",
            },
            {
                id: "bench_planning",
                description: "Design a REST API for a task management system with auth",
                intent: "planning",
                expected_keywords: ["endpoint", "authentication", "CRUD"],
                expected_format: "text",
                difficulty: "hard",
            },
            {
                id: "bench_synthesis",
                description: "Synthesize a summary from these points: performance, cost, reliability",
                intent: "synthesis",
                expected_keywords: ["performance", "cost", "reliability"],
                expected_format: "text",
                difficulty: "easy",
            },
        ];

        for (const task of tasks) {
            this.addTask(task);
        }
    }

    // ── Recording ───────────────────────────────────────────────────────────

    /** Record a benchmark run result. */
    recordRun(run: BenchmarkRun): void {
        this.runs.push(run);
    }

    /** Compute accuracy score for a run based on task criteria. */
    scoreAccuracy(task: BenchmarkTask, output: string): number {
        let score = 0;
        let checks = 0;

        // Keyword matching
        if (task.expected_keywords && task.expected_keywords.length > 0) {
            const lower = output.toLowerCase();
            const matched = task.expected_keywords.filter(kw => lower.includes(kw.toLowerCase()));
            score += matched.length / task.expected_keywords.length;
            checks++;
        }

        // Format check
        if (task.expected_format) {
            checks++;
            if (task.expected_format === "json") {
                try {
                    JSON.parse(output);
                    score += 1;
                } catch {
                    score += 0;
                }
            } else if (task.expected_format === "code") {
                score += (output.includes("def ") || output.includes("function ") || output.includes("class ")) ? 1 : 0.5;
            } else {
                score += output.length > 50 ? 1 : 0.5;
            }
        }

        // Length check (non-trivial output)
        checks++;
        score += output.length > 100 ? 1 : output.length > 20 ? 0.5 : 0;

        return checks > 0 ? score / checks : 0;
    }

    // ── Reporting ───────────────────────────────────────────────────────────

    /** Generate a full comparison report. */
    generateReport(): BenchmarkReport {
        const taskIds = [...new Set(this.runs.map(r => r.task_id))];
        const systems = [...new Set(this.runs.map(r => r.system))];

        // Per-task comparisons
        const comparisons: BenchmarkComparison[] = [];
        for (const taskId of taskIds) {
            const taskRuns = this.runs.filter(r => r.task_id === taskId);
            const task = this.tasks.find(t => t.id === taskId);

            // Score each run
            const scored = taskRuns.map(run => ({
                run,
                composite: this.compositeScore(run),
            }));

            scored.sort((a, b) => b.composite - a.composite);
            const winner = scored[0];

            comparisons.push({
                task_id: taskId,
                task_description: task?.description ?? taskId,
                runs: taskRuns,
                winner: winner.run.system,
                winner_reason: `Composite score: ${winner.composite.toFixed(3)} (acc: ${winner.run.accuracy_score.toFixed(2)}, lat: ${winner.run.latency_ms}ms, cost: $${winner.run.cost_usd.toFixed(4)})`,
            });
        }

        // Per-system summaries
        const summary: Record<string, SystemSummary> = {};
        for (const system of systems) {
            const sysRuns = this.runs.filter(r => r.system === system);
            const wins = comparisons.filter(c => c.winner === system).length;

            summary[system] = {
                system,
                total_runs: sysRuns.length,
                avg_accuracy: sysRuns.reduce((s, r) => s + r.accuracy_score, 0) / sysRuns.length,
                avg_latency_ms: sysRuns.reduce((s, r) => s + r.latency_ms, 0) / sysRuns.length,
                avg_cost_usd: sysRuns.reduce((s, r) => s + r.cost_usd, 0) / sysRuns.length,
                avg_tokens: sysRuns.reduce((s, r) => s + r.tokens_used, 0) / sysRuns.length,
                total_cost_usd: sysRuns.reduce((s, r) => s + r.cost_usd, 0),
                wins,
                composite_score: sysRuns.reduce((s, r) => s + this.compositeScore(r), 0) / sysRuns.length,
            };
        }

        // Overall winner
        const sortedSystems = Object.values(summary).sort((a, b) => b.composite_score - a.composite_score);
        const overallWinner = sortedSystems[0];

        return {
            total_tasks: taskIds.length,
            total_runs: this.runs.length,
            comparisons,
            summary,
            winner: overallWinner.system,
            winner_reason: `Highest composite score: ${overallWinner.composite_score.toFixed(3)} (${overallWinner.wins}/${taskIds.length} wins, avg accuracy: ${overallWinner.avg_accuracy.toFixed(2)})`,
        };
    }

    /** Compute composite score for a single run. Higher = better. */
    private compositeScore(run: BenchmarkRun): number {
        const latencyNorm = Math.min(run.latency_ms / 30000, 1);   // 30s = max penalty
        const costNorm = Math.min(run.cost_usd / 0.05, 1);         // $0.05 = max penalty

        return (
            this.weights.accuracy * run.accuracy_score -
            this.weights.latency * latencyNorm -
            this.weights.cost * costNorm
        );
    }

    /** Number of tasks registered. */
    get taskCount(): number {
        return this.tasks.length;
    }

    /** Number of runs recorded. */
    get runCount(): number {
        return this.runs.length;
    }

    /** Clear all data. */
    clear(): void {
        this.tasks = [];
        this.runs = [];
    }
}
