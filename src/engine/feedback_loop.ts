// ─────────────────────────────────────────────────────────────────────────────
// MMCP Self-Improving Feedback Loop  |  v2.1
// Connects execution → verifier → context memory → router update.
// Enables autonomous improvement: each pipeline run makes the next one better.
// ─────────────────────────────────────────────────────────────────────────────

import { ContextEngine, TaskRecord } from "./context_engine";
import { ScoredRouter } from "../routing/router";
import { IntentAwareVerifier, VerificationResult, VerificationConstraint } from "../operations/verifier";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FeedbackEntry {
    feedback_id: string;
    task_id: string;
    model: string;
    intent: string;
    verification: VerificationResult;
    latency_ms: number;
    cost_usd: number;
    tokens_used: number;
    router_action: "reward" | "penalize" | "neutral";
    timestamp: string;
}

export interface ImprovementMetrics {
    total_feedback_entries: number;
    avg_confidence_trend: number[];     // rolling average confidence
    model_improvement: Record<string, { before: number; after: number }>;
    top_failure_patterns: Array<{ pattern: string; count: number }>;
}

// ── Feedback Loop ────────────────────────────────────────────────────────────

export class FeedbackLoop {
    private contextEngine: ContextEngine;
    private router: ScoredRouter;
    private verifier: IntentAwareVerifier;
    private history: FeedbackEntry[] = [];
    private confidenceWindow: number[] = [];
    private windowSize: number;
    private failurePatterns = new Map<string, number>();

    constructor(
        contextEngine: ContextEngine,
        router: ScoredRouter,
        verifier: IntentAwareVerifier,
        windowSize: number = 50
    ) {
        this.contextEngine = contextEngine;
        this.router = router;
        this.verifier = verifier;
        this.windowSize = windowSize;
    }

    /**
     * Process a completed step: verify → store in memory → update router.
     * This is the core feedback cycle that enables self-improvement.
     */
    processFeedback(params: {
        task_id: string;
        model: string;
        intent: string;
        output: string;
        latency_ms: number;
        cost_usd: number;
        tokens_used: number;
        extraConstraints?: VerificationConstraint[];
    }): FeedbackEntry {
        // 1. VERIFY — run intent-aware verification
        const verification = this.verifier.verify(
            params.output,
            params.intent,
            params.extraConstraints ?? []
        );

        // 2. DETERMINE ROUTER ACTION
        let routerAction: "reward" | "penalize" | "neutral";
        if (verification.passed && verification.confidence >= 0.8) {
            routerAction = "reward";
        } else if (!verification.passed || verification.confidence < 0.4) {
            routerAction = "penalize";
        } else {
            routerAction = "neutral";
        }

        // 3. UPDATE ROUTER — record outcome for learning
        this.router.recordOutcome(
            params.model,
            verification.passed,
            params.latency_ms,
            params.cost_usd
        );

        // 4. STORE IN MEMORY — record step in context engine
        try {
            this.contextEngine.recordStep(params.task_id, {
                agent: params.intent,
                ctx_id: `feedback_${Date.now()}`,
                input: params.intent,
                output: params.output.slice(0, 500),
                model: params.model,
                latency_ms: params.latency_ms,
                tokens_used: params.tokens_used,
                cost_usd: params.cost_usd,
                confidence: verification.confidence,
            });
        } catch {
            // Task may not exist in context engine — that's ok
        }

        // 5. TRACK FAILURE PATTERNS
        if (!verification.passed) {
            for (const check of verification.checks) {
                if (!check.passed) {
                    const pattern = `${check.type}:${check.constraint.slice(0, 50)}`;
                    this.failurePatterns.set(pattern, (this.failurePatterns.get(pattern) ?? 0) + 1);
                }
            }
        }

        // 6. UPDATE CONFIDENCE TREND
        this.confidenceWindow.push(verification.confidence);
        if (this.confidenceWindow.length > this.windowSize) {
            this.confidenceWindow.shift();
        }

        // 7. CREATE FEEDBACK ENTRY
        const entry: FeedbackEntry = {
            feedback_id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            task_id: params.task_id,
            model: params.model,
            intent: params.intent,
            verification,
            latency_ms: params.latency_ms,
            cost_usd: params.cost_usd,
            tokens_used: params.tokens_used,
            router_action: routerAction,
            timestamp: new Date().toISOString(),
        };

        this.history.push(entry);
        return entry;
    }

    /** Get improvement metrics over time. */
    getMetrics(): ImprovementMetrics {
        // Calculate rolling confidence averages (in windows of 10)
        const trends: number[] = [];
        for (let i = 0; i < this.confidenceWindow.length; i += 10) {
            const slice = this.confidenceWindow.slice(i, i + 10);
            trends.push(slice.reduce((s, v) => s + v, 0) / slice.length);
        }

        // Top failure patterns
        const topFailures = Array.from(this.failurePatterns.entries())
            .map(([pattern, count]) => ({ pattern, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // Model improvement (compare first half vs second half of history)
        const mid = Math.floor(this.history.length / 2);
        const modelImprovement: Record<string, { before: number; after: number }> = {};

        if (mid > 0) {
            const firstHalf = this.history.slice(0, mid);
            const secondHalf = this.history.slice(mid);

            const models = new Set(this.history.map(h => h.model));
            for (const model of models) {
                const beforeEntries = firstHalf.filter(h => h.model === model);
                const afterEntries = secondHalf.filter(h => h.model === model);
                const before = beforeEntries.length > 0
                    ? beforeEntries.reduce((s, e) => s + e.verification.confidence, 0) / beforeEntries.length
                    : 0;
                const after = afterEntries.length > 0
                    ? afterEntries.reduce((s, e) => s + e.verification.confidence, 0) / afterEntries.length
                    : 0;
                modelImprovement[model] = { before, after };
            }
        }

        return {
            total_feedback_entries: this.history.length,
            avg_confidence_trend: trends,
            model_improvement: modelImprovement,
            top_failure_patterns: topFailures,
        };
    }

    /** Get the most recent N feedback entries. */
    getRecentFeedback(limit: number = 20): FeedbackEntry[] {
        return this.history.slice(-limit);
    }

    /** Total feedback entries processed. */
    get size(): number {
        return this.history.length;
    }

    /** Clear all history. */
    clear(): void {
        this.history = [];
        this.confidenceWindow = [];
        this.failurePatterns.clear();
    }
}
