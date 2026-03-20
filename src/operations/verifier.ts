// ─────────────────────────────────────────────────────────────────────────────
// MMCP Intent-Aware Verifier  |  v2.0
// Validates output against intent + constraints, not just quality.
// Supports built-in checks and custom constraints with retry recommendations.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export type ConstraintType = "contains" | "format" | "security" | "logic" | "custom";

export interface VerificationConstraint {
    type: ConstraintType;
    description: string;
    /**
     * Check function: returns true if the constraint passes.
     * @param output - The actual output from the agent
     * @param intent - The original intent/task description
     */
    check: (output: string, intent: string) => boolean;
}

export interface ConstraintResult {
    constraint: string;            // description
    type: ConstraintType;
    passed: boolean;
    detail: string;
}

export interface VerificationResult {
    passed: boolean;
    checks: ConstraintResult[];
    confidence: number;            // 0.0–1.0, based on % of checks passed
    retry_recommendation?: {
        switch_model?: string;
        reason: string;
    };
}

// ── Built-in Constraint Factories ────────────────────────────────────────────

export const BuiltinConstraints = {

    /** Output must contain all specified keywords. */
    containsKeywords(keywords: string[]): VerificationConstraint {
        return {
            type: "contains",
            description: `Output must contain: ${keywords.join(", ")}`,
            check: (output: string) => {
                const lower = output.toLowerCase();
                return keywords.every(kw => lower.includes(kw.toLowerCase()));
            },
        };
    },

    /** Output must be valid JSON. */
    isValidJSON(): VerificationConstraint {
        return {
            type: "format",
            description: "Output must be valid JSON",
            check: (output: string) => {
                try {
                    JSON.parse(output);
                    return true;
                } catch {
                    return false;
                }
            },
        };
    },

    /** Output must not contain common security anti-patterns. */
    noSecurityIssues(): VerificationConstraint {
        const patterns = [
            /eval\s*\(/i,
            /innerHTML\s*=/i,
            /document\.write/i,
            /password\s*=\s*['"][^'"]+['"]/i,
            /api[_-]?key\s*=\s*['"][^'"]+['"]/i,
            /SELECT\s+\*\s+FROM/i,
        ];
        return {
            type: "security",
            description: "Output must not contain security anti-patterns (eval, innerHTML, hardcoded credentials, SQL injection)",
            check: (output: string) => {
                return !patterns.some(p => p.test(output));
            },
        };
    },

    /** Output must be at least N characters long. */
    minLength(n: number): VerificationConstraint {
        return {
            type: "format",
            description: `Output must be at least ${n} characters`,
            check: (output: string) => output.length >= n,
        };
    },

    /** Output must contain the intent/task keywords (validates it addressed the prompt). */
    addressesIntent(): VerificationConstraint {
        return {
            type: "logic",
            description: "Output must address the original intent (contain at least 30% of intent keywords)",
            check: (output: string, intent: string) => {
                const intentWords = intent.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                if (intentWords.length === 0) return true;
                const outputLower = output.toLowerCase();
                const matched = intentWords.filter(w => outputLower.includes(w));
                return matched.length >= intentWords.length * 0.3;
            },
        };
    },
};

// ── IntentAwareVerifier ──────────────────────────────────────────────────────

export class IntentAwareVerifier {
    private constraints: VerificationConstraint[] = [];

    /** Add a constraint to the verifier. */
    addConstraint(constraint: VerificationConstraint): void {
        this.constraints.push(constraint);
    }

    /** Add multiple constraints. */
    addConstraints(constraints: VerificationConstraint[]): void {
        this.constraints.push(...constraints);
    }

    /**
     * Verify output against intent and all registered constraints.
     * @param output - The model output to verify
     * @param intent - The original task/intent description
     * @param extraConstraints - Additional one-off constraints for this check
     * @param retryModel - Model to recommend on failure
     */
    verify(
        output: string,
        intent: string,
        extraConstraints: VerificationConstraint[] = [],
        retryModel?: string
    ): VerificationResult {
        const allConstraints = [...this.constraints, ...extraConstraints];
        const checks: ConstraintResult[] = [];

        for (const constraint of allConstraints) {
            let passed = false;
            let detail = "";

            try {
                passed = constraint.check(output, intent);
                detail = passed ? "Passed" : "Failed";
            } catch (err) {
                passed = false;
                detail = `Error: ${err instanceof Error ? err.message : String(err)}`;
            }

            checks.push({
                constraint: constraint.description,
                type: constraint.type,
                passed,
                detail,
            });
        }

        const totalChecks = checks.length;
        const passedChecks = checks.filter(c => c.passed).length;
        const confidence = totalChecks > 0 ? passedChecks / totalChecks : 1;
        const allPassed = passedChecks === totalChecks;

        const result: VerificationResult = {
            passed: allPassed,
            checks,
            confidence,
        };

        // Add retry recommendation if failed
        if (!allPassed) {
            const failedTypes = checks.filter(c => !c.passed).map(c => c.type);
            const hasSecurityFail = failedTypes.includes("security");
            const hasLogicFail = failedTypes.includes("logic");

            result.retry_recommendation = {
                switch_model: retryModel,
                reason: hasSecurityFail
                    ? "Security constraint failed — consider a model with better code safety"
                    : hasLogicFail
                        ? "Logic/intent constraint failed — consider a stronger reasoning model"
                        : `${totalChecks - passedChecks}/${totalChecks} constraint checks failed`,
            };
        }

        return result;
    }

    /** Generate a system prompt suffix that instructs the model about verification constraints. */
    generateConstraintPrompt(): string {
        if (this.constraints.length === 0) return "";

        const lines = this.constraints.map((c, i) =>
            `${i + 1}. [${c.type.toUpperCase()}] ${c.description}`
        );

        return (
            "\n\nVERIFICATION CONSTRAINTS (your output will be checked against these):\n" +
            lines.join("\n")
        );
    }

    /** Number of registered constraints. */
    get size(): number {
        return this.constraints.length;
    }

    /** Clear all constraints. */
    clear(): void {
        this.constraints = [];
    }
}

// ── Multi-Verifier Voting ────────────────────────────────────────────────────
// Runs N verifiers and reaches consensus via configurable voting strategy.

export type VotingStrategy = "majority" | "unanimous" | "weighted";

export interface MultiVerifierResult {
    passed: boolean;
    votes: Array<{ verifier_id: string; result: VerificationResult }>;
    consensus: VotingStrategy;
    confidence: number;      // aggregate confidence across all voters
    total_voters: number;
    votes_passed: number;
    votes_failed: number;
}

export class MultiVerifier {
    private verifiers: Array<{ id: string; verifier: IntentAwareVerifier; weight: number }> = [];
    private strategy: VotingStrategy;

    constructor(strategy: VotingStrategy = "majority") {
        this.strategy = strategy;
    }

    /** Register a critic verifier with optional weight (for weighted voting). */
    addVerifier(id: string, verifier: IntentAwareVerifier, weight: number = 1): void {
        this.verifiers.push({ id, verifier, weight });
    }

    /** Run all verifiers and reach consensus. */
    verify(output: string, intent: string, retryModel?: string): MultiVerifierResult {
        const votes: Array<{ verifier_id: string; result: VerificationResult; weight: number }> = [];

        for (const { id, verifier, weight } of this.verifiers) {
            const result = verifier.verify(output, intent, [], retryModel);
            votes.push({ verifier_id: id, result, weight });
        }

        const passed = this.computeConsensus(votes);
        const totalWeight = votes.reduce((s, v) => s + v.weight, 0);
        const passedWeight = votes.filter(v => v.result.passed).reduce((s, v) => s + v.weight, 0);

        return {
            passed,
            votes: votes.map(v => ({ verifier_id: v.verifier_id, result: v.result })),
            consensus: this.strategy,
            confidence: totalWeight > 0 ? passedWeight / totalWeight : 0,
            total_voters: votes.length,
            votes_passed: votes.filter(v => v.result.passed).length,
            votes_failed: votes.filter(v => !v.result.passed).length,
        };
    }

    private computeConsensus(votes: Array<{ result: VerificationResult; weight: number }>): boolean {
        switch (this.strategy) {
            case "unanimous":
                return votes.every(v => v.result.passed);
            case "majority": {
                const passedWeight = votes.filter(v => v.result.passed).reduce((s, v) => s + v.weight, 0);
                const totalWeight = votes.reduce((s, v) => s + v.weight, 0);
                return passedWeight > totalWeight / 2;
            }
            case "weighted": {
                const passedWeight = votes.filter(v => v.result.passed).reduce((s, v) => s + v.weight, 0);
                const totalWeight = votes.reduce((s, v) => s + v.weight, 0);
                return totalWeight > 0 && passedWeight / totalWeight >= 0.6;
            }
            default:
                return false;
        }
    }

    /** Total number of registered verifiers. */
    get size(): number {
        return this.verifiers.length;
    }
}

