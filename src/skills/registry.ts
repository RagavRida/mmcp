// ─────────────────────────────────────────────────────────────────────────────
// Skill Registry | MMCP v0.3
// ─────────────────────────────────────────────────────────────────────────────

export type SkillCategory =
    | "reasoning"
    | "coding"
    | "research"
    | "verification"
    | "summarization"
    | "planning"
    | "domain_specific";

export interface Skill {
    id: string;
    name: string;
    description: string;
    input_schema?: unknown;
    output_schema?: unknown;
    category: SkillCategory;
}

export interface ModelSkillProfile {
    model_id: string;
    skills: string[];              // skill ids this model is good at
    cost_per_1k_input: number;     // USD
    cost_per_1k_output: number;    // USD
    context_window: number;        // max tokens
    strengths: string[];           // free text, used in system prompts
    vendor: "anthropic" | "openai" | "google" | "mistral" | "openrouter";
}

export interface SkillMatch {
    model_id: string;
    matched_skills: string[];
    missing_skills: string[];
    score: number;                 // 0-1, how well model matches required skills
    estimated_cost: number;        // per 1k tokens average (input + output / 2)
}

export class SkillRegistry {
    private skills = new Map<string, Skill>();
    private models = new Map<string, ModelSkillProfile>();

    registerSkill(skill: Skill): void {
        this.skills.set(skill.id, skill);
    }

    registerModel(profile: ModelSkillProfile): void {
        this.models.set(profile.model_id, profile);
    }

    getSkill(id: string): Skill | null {
        return this.skills.get(id) ?? null;
    }

    getModel(model_id: string): ModelSkillProfile | null {
        return this.models.get(model_id) ?? null;
    }

    findModels(required_skills: string[]): SkillMatch[] {
        const matches: SkillMatch[] = [];

        for (const model of this.models.values()) {
            const matched = required_skills.filter(s => model.skills.includes(s));
            const missing = required_skills.filter(s => !model.skills.includes(s));
            const score = required_skills.length === 0 ? 0 : matched.length / required_skills.length;

            const estimated_cost = (model.cost_per_1k_input + model.cost_per_1k_output) / 2;

            matches.push({
                model_id: model.model_id,
                matched_skills: matched,
                missing_skills: missing,
                score,
                estimated_cost,
            });
        }

        // Sort by score desc, then cost asc
        return matches.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.estimated_cost - b.estimated_cost;
        });
    }

    bestModel(required_skills: string[]): SkillMatch | null {
        const models = this.findModels(required_skills);
        if (models.length === 0) return null;
        return models[0]; // Already sorted by score desc, then cost asc
    }

    cheapestModel(required_skills: string[]): SkillMatch | null {
        const models = this.findModels(required_skills);
        // Find models that have ALL required skills (score === 1)
        const capable = models.filter(m => m.score === 1);

        if (capable.length === 0) return null; // Or return cheapest partial match? The prompt says "cheapest model that has ALL required skills"

        // capable is already sorted by cost ascending (since findModels sorts by cost for tied scores)
        return capable[0];
    }

    canHandle(model_id: string, skill_id: string): boolean {
        const model = this.models.get(model_id);
        if (!model) return false;
        return model.skills.includes(skill_id);
    }

    listSkills(category?: SkillCategory): Skill[] {
        const all = Array.from(this.skills.values());
        if (category) {
            return all.filter(s => s.category === category);
        }
        return all;
    }

    listModels(vendor?: string): ModelSkillProfile[] {
        const all = Array.from(this.models.values());
        if (vendor) {
            return all.filter(m => m.vendor === vendor);
        }
        return all;
    }
}

// ── Default Exports ──────────────────────────────────────────────────────────

export const defaultSkillRegistry = new SkillRegistry();

const DEFAULT_SKILLS: Skill[] = [
    { id: "reasoning", name: "Reasoning", description: "Complex logic and deduction", category: "reasoning" },
    { id: "code_generation", name: "Code Generation", description: "Writing new code", category: "coding" },
    { id: "code_review", name: "Code Review", description: "Analyzing code for bugs/quality", category: "verification" },
    { id: "code_execution", name: "Code Execution", description: "Running generated code", category: "coding" },
    { id: "web_search", name: "Web Search", description: "Finding information online", category: "research" },
    { id: "summarization", name: "Summarization", description: "Condensing long text", category: "summarization" },
    { id: "planning", name: "Planning", description: "Breaking down complex tasks", category: "planning" },
    { id: "fact_checking", name: "Fact Checking", description: "Verifying claims", category: "verification" },
    { id: "long_context", name: "Long Context", description: "Processing large documents", category: "reasoning" },
    { id: "classification", name: "Classification", description: "Categorizing input", category: "reasoning" },
    { id: "data_extraction", name: "Data Extraction", description: "Pulling structured data from unstructured text", category: "reasoning" },
    { id: "security_analysis", name: "Security Analysis", description: "Finding security vulnerabilities", category: "verification" },
    { id: "sql_generation", name: "SQL Generation", description: "Writing database queries", category: "coding" },
    { id: "api_design", name: "API Design", description: "Designing system interfaces", category: "planning" },
];

for (const skill of DEFAULT_SKILLS) {
    defaultSkillRegistry.registerSkill(skill);
}

const DEFAULT_MODELS: ModelSkillProfile[] = [
    {
        model_id: "claude-opus-4-20250514",
        skills: ["reasoning", "planning", "code_review", "fact_checking", "security_analysis", "api_design", "long_context"],
        cost_per_1k_input: 0.015,     // $15 per 1M
        cost_per_1k_output: 0.075,    // $75 per 1M
        context_window: 200000,
        strengths: ["complex reasoning", "deep analysis", "security"],
        vendor: "anthropic"
    },
    {
        model_id: "claude-sonnet-4-20250514",
        skills: ["reasoning", "code_generation", "code_review", "summarization", "planning", "classification", "data_extraction", "api_design"],
        cost_per_1k_input: 0.003,     // $3 per 1M
        cost_per_1k_output: 0.015,    // $15 per 1M
        context_window: 200000,
        strengths: ["balanced performance", "coding", "fast reasoning"],
        vendor: "anthropic"
    },
    {
        model_id: "claude-haiku-4-5-20251001",
        skills: ["summarization", "classification", "data_extraction", "code_generation", "fast_response"],
        cost_per_1k_input: 0.00025,   // $0.25 per 1M
        cost_per_1k_output: 0.00125,  // $1.25 per 1M
        context_window: 200000,
        strengths: ["speed", "cost efficiency", "simple tasks"],
        vendor: "anthropic"
    }
];

// Note: "fast_response" is implicitly requested as a skill string, though it's not in the default skills list. 
// It works as it's just a string match.

for (const model of DEFAULT_MODELS) {
    defaultSkillRegistry.registerModel(model);
}
