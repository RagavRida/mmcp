import { describe, it, expect } from "@jest/globals";
import { IntentAwareVerifier, BuiltinConstraints } from "../src/operations/verifier";

describe("IntentAwareVerifier", () => {

    it("passes when all constraints pass", () => {
        const v = new IntentAwareVerifier();
        v.addConstraint(BuiltinConstraints.containsKeywords(["jwt", "login"]));
        v.addConstraint(BuiltinConstraints.minLength(10));

        const result = v.verify(
            "This code implements JWT-based login authentication",
            "Build login system using JWT"
        );

        expect(result.passed).toBe(true);
        expect(result.confidence).toBe(1);
        expect(result.checks).toHaveLength(2);
        expect(result.retry_recommendation).toBeUndefined();
    });

    it("fails when keywords are missing", () => {
        const v = new IntentAwareVerifier();
        v.addConstraint(BuiltinConstraints.containsKeywords(["jwt", "oauth"]));

        const result = v.verify(
            "This code implements basic password login",
            "Build login system using JWT and OAuth"
        );

        expect(result.passed).toBe(false);
        expect(result.confidence).toBeLessThan(1);
        expect(result.retry_recommendation).toBeDefined();
    });

    it("detects security issues", () => {
        const v = new IntentAwareVerifier();
        v.addConstraint(BuiltinConstraints.noSecurityIssues());

        const result = v.verify(
            'const password = "hardcoded123";\neval(userInput);',
            "Write secure code"
        );

        expect(result.passed).toBe(false);
        expect(result.checks[0].type).toBe("security");
        expect(result.retry_recommendation?.reason).toContain("Security");
    });

    it("validates JSON format", () => {
        const v = new IntentAwareVerifier();
        v.addConstraint(BuiltinConstraints.isValidJSON());

        const good = v.verify('{"key": "value"}', "Return JSON");
        expect(good.passed).toBe(true);

        const bad = v.verify("not json at all", "Return JSON");
        expect(bad.passed).toBe(false);
    });

    it("checks intent relevance via addressesIntent()", () => {
        const v = new IntentAwareVerifier();
        v.addConstraint(BuiltinConstraints.addressesIntent());

        const relevant = v.verify(
            "The authentication system uses JWT tokens with refresh flow and secure cookies",
            "Build authentication system with JWT tokens"
        );
        expect(relevant.passed).toBe(true);

        const irrelevant = v.verify(
            "Here is a recipe for chocolate cake with vanilla frosting",
            "Build authentication system with JWT tokens"
        );
        expect(irrelevant.passed).toBe(false);
    });

    it("supports extra one-off constraints", () => {
        const v = new IntentAwareVerifier();
        v.addConstraint(BuiltinConstraints.minLength(5));

        const result = v.verify("Hello world", "Greet", [
            {
                type: "custom",
                description: "Must contain 'world'",
                check: (output) => output.includes("world"),
            },
        ]);

        expect(result.passed).toBe(true);
        expect(result.checks).toHaveLength(2); // minLength + custom
    });

    it("retry_recommendation includes switch_model when provided", () => {
        const v = new IntentAwareVerifier();
        v.addConstraint(BuiltinConstraints.containsKeywords(["nonexistent"]));

        const result = v.verify("Hello", "intent", [], "claude-opus-4-20250514");
        expect(result.passed).toBe(false);
        expect(result.retry_recommendation?.switch_model).toBe("claude-opus-4-20250514");
    });

    it("generateConstraintPrompt includes all constraints", () => {
        const v = new IntentAwareVerifier();
        v.addConstraint(BuiltinConstraints.containsKeywords(["jwt"]));
        v.addConstraint(BuiltinConstraints.noSecurityIssues());

        const prompt = v.generateConstraintPrompt();
        expect(prompt).toContain("VERIFICATION CONSTRAINTS");
        expect(prompt).toContain("jwt");
        expect(prompt).toContain("SECURITY");
    });

    it("confidence is proportional to checks passed", () => {
        const v = new IntentAwareVerifier();
        v.addConstraint(BuiltinConstraints.minLength(5));
        v.addConstraint(BuiltinConstraints.containsKeywords(["nonexistent"]));

        const result = v.verify("Hello world", "intent");
        expect(result.confidence).toBe(0.5); // 1/2 passed
    });
});
