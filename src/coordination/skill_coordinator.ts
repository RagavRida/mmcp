/**
 * Skill-Aware Coordinator — agents auto-adapt based on skills.
 *
 * Extends AgentCoordinator with:
 *   - Auto-skill detection: new agent → detect what it's good at
 *   - Skill-based handoff: "I need code_review" → finds best agent
 *   - Skill evolution: agent learns new skills over time from outcomes
 *   - Skill gaps: detects what NO agent can do, reports missing coverage
 *   - Cross-framework: LangChain agent can hand off to CrewAI agent by skill
 */

import { AgentCoordinator, AgentRegistration, HandoffPayload, HandoffResult } from "./coordinator";
import { SkillRegistry, Skill, ModelSkillProfile, SkillMatch } from "../skills/registry";

export interface SkillOutcome {
  agent_id: string;
  skill: string;
  success: boolean;
  latency_ms: number;
  quality_score?: number;  // 0-1, how well it performed
}

interface AgentSkillStats {
  skill: string;
  attempts: number;
  successes: number;
  avg_latency_ms: number;
  avg_quality: number;
}

export class SkillCoordinator {
  private coordinator: AgentCoordinator;
  private registry: SkillRegistry;
  private agent_skills = new Map<string, Map<string, AgentSkillStats>>();  // agent_id → skill → stats
  private skill_history: SkillOutcome[] = [];
  private lost_skills = new Set<string>();  // "agent_id::skill" — skills agents lost due to poor performance

  constructor(coordinator?: AgentCoordinator, registry?: SkillRegistry) {
    this.coordinator = coordinator ?? new AgentCoordinator();
    this.registry = registry ?? new SkillRegistry();
  }

  /** Get the underlying coordinator for direct access */
  getCoordinator(): AgentCoordinator {
    return this.coordinator;
  }

  /** Get the skill registry */
  getRegistry(): SkillRegistry {
    return this.registry;
  }

  // ── Register with Skills ──────────────────────────────────────────

  /** Register an agent with explicit skills */
  register(config: {
    name: string;
    skills: string[];
    handler: (handoff: HandoffPayload) => Promise<HandoffResult>;
    metadata?: Record<string, any>;
  }): string {
    // Register skills in the registry if they don't exist
    for (const skill of config.skills) {
      if (!this.registry.getSkill(skill)) {
        this.registry.registerSkill({
          id: skill,
          name: skill.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          description: `Auto-registered skill: ${skill}`,
          category: "domain_specific",
        });
      }
    }

    // Register in coordinator with skills as capabilities
    const agent_id = this.coordinator.register({
      name: config.name,
      capabilities: config.skills,
      handler: config.handler,
      metadata: { ...config.metadata, skills: config.skills },
    });

    // Initialize skill stats
    this.agent_skills.set(agent_id, new Map());
    for (const skill of config.skills) {
      this.agent_skills.get(agent_id)!.set(skill, {
        skill,
        attempts: 0,
        successes: 0,
        avg_latency_ms: 0,
        avg_quality: 0.5,
      });
    }

    return agent_id;
  }

  // ── Skill-Based Handoff ───────────────────────────────────────────

  /** Hand off by skill — find the best agent for the skill, not by name */
  async handoffBySkill(
    from_agent: string,
    conversation_id: string,
    messages: HandoffPayload["messages"],
    required_skills: string[],
    reason: string,
    priority: HandoffPayload["priority"] = "normal",
  ): Promise<HandoffResult> {
    // Score all agents by their skill match + performance history
    const candidates = this._rankBySkill(required_skills);

    if (candidates.length === 0) {
      return { accepted: false, agent_id: "", error: `No agent has skills: ${required_skills.join(", ")}` };
    }

    // Try top candidate first, fall back to next
    for (const candidate of candidates) {
      const result = await this.coordinator.handoff({
        from_agent,
        to_agent: candidate.agent_id,
        conversation_id,
        messages,
        context: { required_skills, skill_match_score: candidate.score },
        reason,
        priority,
      });

      if (result.accepted) return result;
    }

    return { accepted: false, agent_id: "", error: "All capable agents rejected the handoff" };
  }

  // ── Skill Learning ────────────────────────────────────────────────

  /** Record how an agent performed on a skill — it learns over time */
  recordOutcome(outcome: SkillOutcome): void {
    this.skill_history.push(outcome);

    const agent_stats = this.agent_skills.get(outcome.agent_id);
    if (!agent_stats) return;

    let stats = agent_stats.get(outcome.skill);
    if (!stats) {
      stats = { skill: outcome.skill, attempts: 0, successes: 0, avg_latency_ms: 0, avg_quality: 0.5 };
      agent_stats.set(outcome.skill, stats);

      // Agent learned a new skill — add to capabilities
      const agents = this.coordinator.listAgents();
      const agent = agents.find(a => a.agent_id === outcome.agent_id);
      if (agent && !agent.capabilities.includes(outcome.skill)) {
        agent.capabilities.push(outcome.skill);
      }
    }

    stats.attempts++;
    if (outcome.success) stats.successes++;
    stats.avg_latency_ms = (stats.avg_latency_ms * (stats.attempts - 1) + outcome.latency_ms) / stats.attempts;
    if (outcome.quality_score !== undefined) {
      stats.avg_quality = (stats.avg_quality * (stats.attempts - 1) + outcome.quality_score) / stats.attempts;
    }

    // If agent is consistently bad at a skill (< 30% over 10+ attempts), mark it lost
    if (stats.attempts >= 10 && stats.successes / stats.attempts < 0.3) {
      this.lost_skills.add(`${outcome.agent_id}::${outcome.skill}`);
    }
  }

  // ── Skill Gap Analysis ────────────────────────────────────────────

  /** What skills does NO agent have? */
  getSkillGaps(): string[] {
    const all_skills = this.registry.listSkills().map(s => s.id);
    const covered = new Set<string>();

    for (const agent of this.coordinator.listAgents()) {
      for (const cap of agent.capabilities) {
        covered.add(cap);
      }
    }

    return all_skills.filter(s => !covered.has(s));
  }

  /** Skill coverage report */
  getCoverage(): Array<{
    skill: string;
    agents: Array<{ agent_id: string; name: string; success_rate: number; avg_quality: number }>;
    gap: boolean;
  }> {
    const all_skills = this.registry.listSkills().map(s => s.id);
    const agents = this.coordinator.listAgents();

    return all_skills.map(skill => {
      const capable = agents
        .filter(a => a.capabilities.includes(skill))
        .map(a => {
          const stats = this.agent_skills.get(a.agent_id)?.get(skill);
          return {
            agent_id: a.agent_id,
            name: a.name,
            success_rate: stats && stats.attempts > 0 ? stats.successes / stats.attempts : 0,
            avg_quality: stats?.avg_quality ?? 0,
          };
        });

      return { skill, agents: capable, gap: capable.length === 0 };
    });
  }

  /** Get an agent's full skill profile with performance stats */
  getAgentProfile(agent_id: string): AgentSkillStats[] {
    const stats = this.agent_skills.get(agent_id);
    if (!stats) return [];
    return Array.from(stats.values());
  }

  // ── Internal ──────────────────────────────────────────────────────

  private _rankBySkill(required_skills: string[]): Array<{ agent_id: string; score: number }> {
    const agents = this.coordinator.listAgents();
    const scored: Array<{ agent_id: string; score: number }> = [];

    for (const agent of agents) {
      if (agent.status === "offline" || agent.status === "busy") continue;

      const matched = required_skills.filter(s =>
        agent.capabilities.includes(s) && !this.lost_skills.has(`${agent.agent_id}::${s}`)
      );
      if (matched.length === 0) continue;

      // Base score: capability match
      let score = matched.length / required_skills.length;

      // Bonus: performance history
      const agent_stats = this.agent_skills.get(agent.agent_id);
      if (agent_stats) {
        let perf_sum = 0;
        let perf_count = 0;
        for (const skill of matched) {
          const s = agent_stats.get(skill);
          if (s && s.attempts > 0) {
            perf_sum += (s.successes / s.attempts) * s.avg_quality;
            perf_count++;
          }
        }
        if (perf_count > 0) {
          score = score * 0.5 + (perf_sum / perf_count) * 0.5;
        }
      }

      scored.push({ agent_id: agent.agent_id, score });
    }

    return scored.sort((a, b) => b.score - a.score);
  }
}
