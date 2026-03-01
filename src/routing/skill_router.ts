import { ContextEnvelope, MMCPRouter, ModelAssignment } from "../core/types";
import { SkillRegistry, SkillMatch } from "../skills/registry";
import { RoleBasedRouter } from "./router";

export type RoutingStrategy = "best_match" | "cheapest" | "cost_optimized";

export class SkillAwareRouter implements MMCPRouter {
    private fallbackRouter: RoleBasedRouter;

    constructor(
        private registry: SkillRegistry,
        private strategy: RoutingStrategy,
        private fallback_model: string,
        private endpoint: string = "https://api.anthropic.com/v1/messages",
        private api_key?: string
    ) {
        this.fallbackRouter = new RoleBasedRouter({}, {
            model_id: this.fallback_model,
            endpoint: this.endpoint,
            api_key: this.api_key,
            system_prompt: `You are the required role.`,
            max_tokens: 1024
        });
    }

    route(context: ContextEnvelope): ModelAssignment {
        const required = context.required_skills ?? [];

        if (required.length === 0) {
            return this.fallbackRouter.route(context);
        }

        const matches = this.registry.findModels(required);
        let chosen: SkillMatch | null = null;
        let reason = "";

        if (matches.length > 0) {
            if (this.strategy === "best_match") {
                chosen = matches[0]; // Already sorted by score desc
                reason = `Selected best match (score: ${chosen.score.toFixed(2)})`;
            } else if (this.strategy === "cheapest") {
                chosen = this.registry.cheapestModel(required);
                if (!chosen) {
                    // Fall back to partial match if no model has all skills
                    chosen = [...matches].sort((a, b) => a.estimated_cost - b.estimated_cost)[0];
                    reason = `Selected cheapest partial match (score: ${chosen.score.toFixed(2)})`;
                } else {
                    reason = "Selected cheapest model with all required skills";
                }
            } else if (this.strategy === "cost_optimized") {
                // Cheapest for simple skills (<=2), best for complex (>2)
                if (required.length <= 2) {
                    chosen = this.registry.cheapestModel(required);
                    if (!chosen) {
                        chosen = [...matches].sort((a, b) => a.estimated_cost - b.estimated_cost)[0];
                    }
                    reason = `Cost optimized (simple task): picked cheapest`;
                } else {
                    chosen = matches[0];
                    reason = `Cost optimized (complex task): picked best match`;
                }
            }
        }

        if (!chosen) {
            chosen = {
                model_id: this.fallback_model,
                matched_skills: [],
                missing_skills: required,
                score: 0,
                estimated_cost: 0
            };
            reason = "No models matched required skills; using fallback model.";
        }

        context.matched_skills = chosen.matched_skills;
        context.missing_skills = chosen.missing_skills;
        context.skill_score = chosen.score;

        // Build system prompt
        const profile = this.registry.getModel(chosen.model_id);
        const strengths = profile ? profile.strengths.join(", ") : "general capabilities";

        let system_prompt = `You are playing the role of: ${context.role.toUpperCase()}.\n`;
        system_prompt += `You were selected because you have these skills: ${chosen.matched_skills.join(", ") || "none explicitly matched"}.\n`;
        system_prompt += `Your known strengths are: ${strengths}.\n`;

        // The shared context snapshot is injected by MMCPOrchestrator in runNode, 
        // so we don't strictly need to inject it here. The prompt states:
        // "Build system_prompt that includes: role description, matched skills list, model strengths from profile, shared context snapshot if available"
        // Since Orchestrator already does the shared context injection in step 124 of src/index.ts,
        // we can either leave it to the orchestrator or do it explicitly here. We'll leave the orchestrator
        // part alone and let it continue appending it.

        return {
            model_id: chosen.model_id,
            endpoint: this.endpoint,
            api_key: this.api_key,
            system_prompt,
            max_tokens: 1024,
            temperature: 0.5
        };
    }
}

export class SkillGapDetector {
    /**
     * Returns skills in required_skills that NO registered model has.
     */
    static detectGaps(context: ContextEnvelope, registry: SkillRegistry): string[] {
        const required = context.required_skills ?? [];
        if (required.length === 0) return [];

        const gaps: string[] = [];
        const allModels = registry.listModels();

        for (const skill of required) {
            const hasSkill = allModels.some(m => m.skills.includes(skill));
            if (!hasSkill) {
                gaps.push(skill);
            }
        }

        return gaps;
    }
}
