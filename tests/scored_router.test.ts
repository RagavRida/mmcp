import { describe, it, expect } from "@jest/globals";
import { ScoredRouter } from "../src/routing/router";
import { createContext } from "../src/core/context";

describe("ScoredRouter", () => {

    it("routes to highest-scored model", () => {
        // Disable exploration (epsilon=0) so routing is deterministic
        const router = new ScoredRouter(["model-a", "model-b"], {}, undefined, undefined, { epsilon: 0 });

        // model-a: 3 successes, fast, cheap
        router.recordOutcome("model-a", true, 1000, 0.001);
        router.recordOutcome("model-a", true, 1200, 0.001);
        router.recordOutcome("model-a", true, 800, 0.001);

        // model-b: 1 success, 2 failures, slow, expensive
        router.recordOutcome("model-b", true, 5000, 0.005);
        router.recordOutcome("model-b", false, 6000, 0.006);
        router.recordOutcome("model-b", false, 7000, 0.007);

        const ctx = createContext({ task: "test", role: "coder", model: "" });
        const assignment = router.route(ctx);

        expect(assignment.model_id).toBe("model-a");
    });

    it("gives neutral score (0.5) for unknown models", () => {
        const router = new ScoredRouter(["model-x"]);
        expect(router.computeScore("model-x")).toBe(0.5);
    });

    it("computes score correctly", () => {
        const router = new ScoredRouter(["m1"], {
            accuracy: 1.0,
            latency: 0,
            cost: 0,
        });

        router.recordOutcome("m1", true, 1000, 0.001);
        router.recordOutcome("m1", false, 2000, 0.002);

        // success_rate = 0.5, accuracy_weight = 1.0, latency/cost = 0
        expect(router.computeScore("m1")).toBe(0.5);
    });

    it("getRankings returns sorted models", () => {
        const router = new ScoredRouter(["fast", "slow"]);

        router.recordOutcome("fast", true, 500, 0.001);
        router.recordOutcome("slow", false, 8000, 0.008);

        const rankings = router.getRankings();
        expect(rankings[0].model).toBe("fast");
        expect(rankings[0].score).toBeGreaterThan(rankings[1].score);
        expect(rankings[0]).toHaveProperty("ucb");
    });

    it("uses custom scoring weights", () => {
        // Weight cost heavily — the cheaper model should win even with slightly lower accuracy
        // Disable UCB exploration (ucbC=0) to test pure scoring weights
        const router = new ScoredRouter(["accurate", "cheap"], {
            accuracy: 0.2,
            latency: 0,
            cost: 0.8,
        }, undefined, undefined, { ucbC: 0 });

        // accurate: 100% success but expensive
        router.recordOutcome("accurate", true, 1000, 0.01);

        // cheap: 80% success but very cheap
        router.recordOutcome("cheap", true, 1000, 0.0001);
        router.recordOutcome("cheap", true, 1000, 0.0001);
        router.recordOutcome("cheap", true, 1000, 0.0001);
        router.recordOutcome("cheap", true, 1000, 0.0001);
        router.recordOutcome("cheap", false, 1000, 0.0001);

        const rankings = router.getRankings();
        expect(rankings[0].model).toBe("cheap");
    });

    it("adds stats for new models via recordOutcome", () => {
        const router = new ScoredRouter(["a"]);
        router.recordOutcome("b", true, 500, 0.001); // model not in candidates
        const rankings = router.getRankings();
        // "b" is tracked but not in candidates, so rankings only has "a"
        expect(rankings).toHaveLength(1);
    });

    it("assignment includes system prompt with RL routing", () => {
        const router = new ScoredRouter(["m1"], {}, undefined, undefined, { epsilon: 0 });
        router.recordOutcome("m1", true, 1000, 0.001);

        const ctx = createContext({ task: "test", role: "coder", model: "" });
        const assignment = router.route(ctx);
        expect(assignment.system_prompt).toContain("RL routing");
    });

    it("epsilon decays after recordOutcome", () => {
        const router = new ScoredRouter(["m1"], {}, undefined, undefined, { epsilon: 0.5, epsilonDecay: 0.5 });
        const before = router.getEpsilon();
        router.recordOutcome("m1", true, 1000, 0.001);
        expect(router.getEpsilon()).toBeLessThan(before);
    });

    it("computeUCB1 returns Infinity for untried models", () => {
        const router = new ScoredRouter(["untried"]);
        expect(router.computeUCB1("untried")).toBe(Infinity);
    });
});
