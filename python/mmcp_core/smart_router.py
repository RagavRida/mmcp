"""
MMCP v2.2 — Smart Router (Value-Based Model Routing).

Intelligent model router that:
  1. Classifies task complexity (trivial → frontier)
  2. Detects task domain (code, math, security, etc.)
  3. Routes to the optimal model tier
  4. Justifies premium model usage with alternatives
  5. Respects budget constraints
  6. Learns from outcomes via UCB1/epsilon-greedy RL

All model tables, pricing, and domain preferences come from MMCPConfig.
Nothing is hardcoded — override via config file or programmatic API.
"""
from __future__ import annotations
import math
import random
from dataclasses import dataclass
from typing import Any

from .types import (
    TaskComplexity, ModelJustification, SmartRouteDecision,
)
from .complexity_analyzer import analyze_complexity


# ── Domain Statistics (for RL learning) ─────────────────────────────────────

@dataclass
class DomainStats:
    """Track model performance per domain for RL routing."""
    total_runs: int = 0
    successes: int = 0
    total_latency_ms: int = 0
    total_cost_usd: float = 0.0

    @property
    def success_rate(self) -> float:
        return self.successes / self.total_runs if self.total_runs else 0.0

    @property
    def avg_latency_ms(self) -> float:
        return self.total_latency_ms / self.total_runs if self.total_runs else 0.0

    @property
    def avg_cost_usd(self) -> float:
        return self.total_cost_usd / self.total_runs if self.total_runs else 0.0


# ── Smart Router ────────────────────────────────────────────────────────────

class SmartRouter:
    """
    Intelligent model router with domain awareness, complexity analysis,
    cost optimization, and reinforcement learning.

    All configuration comes from MMCPConfig — nothing hardcoded.

    Usage:
        # With defaults
        router = SmartRouter()

        # With custom config
        router = SmartRouter(config=MMCPConfig(
            models={"pricing": {"my-model": {"input": 1, "output": 2}}},
        ))
    """

    def __init__(
        self,
        config: Any | None = None,
        daily_budget_usd: float | None = None,
    ) -> None:
        # Load config
        if config is None:
            from .config import get_config
            config = get_config()
        self._config = config

        # Routing params from config
        self.weights = dict(config.routing_weights)
        self.epsilon = config.epsilon
        self.epsilon_decay = config.epsilon_decay
        self.epsilon_min = config.epsilon_min
        self.ucb_c = config.ucb_c

        # Budget
        self.daily_budget_usd = daily_budget_usd or config.daily_budget_usd
        self.spent_today_usd = 0.0

        # RL state
        self._domain_stats: dict[str, DomainStats] = {}
        self._overall_stats: dict[str, DomainStats] = {}
        self._total_invocations = 0

    # ── Main Routing Method ─────────────────────────────────────────────

    def route(
        self,
        task: str,
        action: str | None = None,
        domain: str | None = None,
        budget_remaining: float | None = None,
    ) -> SmartRouteDecision:
        """
        Route a task to the optimal model with full justification.

        All model lookups use config tables — not hardcoded dicts.
        """
        cfg = self._config

        # 1. Analyze complexity
        analysis = analyze_complexity(task, domain, config=cfg)
        complexity = analysis.complexity
        detected_domain = analysis.domain

        # Override with action-based complexity if provided
        if action and action in cfg.action_complexity:
            action_tier = cfg.get_complexity_tier(cfg.action_complexity[action])
            if _tier_rank(action_tier) > _tier_rank(complexity):
                complexity = action_tier

        # 2. Check budget constraints
        effective_budget = budget_remaining
        if effective_budget is None and self.daily_budget_usd:
            effective_budget = self.daily_budget_usd - self.spent_today_usd

        budget_constrained = False
        if effective_budget is not None and effective_budget < 0.001:
            complexity = TaskComplexity.TRIVIAL
            budget_constrained = True

        # 3. Get candidate models from config
        tier_key = complexity.value
        candidates = cfg.complexity_models.get(
            tier_key,
            cfg.complexity_models.get("standard", [cfg.default_model]),
        )

        # 4. Check domain-specific preference from config
        domain_pref_map = cfg.domain_preferences.get(detected_domain, {})
        domain_pref = domain_pref_map.get(tier_key)

        # 5. Select model (RL-aware or domain-preferred)
        if domain_pref and domain_pref in set(cfg.model_pricing.keys()):
            chosen = domain_pref
            reason = f"domain preference ({detected_domain})"
        elif self._total_invocations > 5:
            chosen, reason = self._rl_select(candidates, detected_domain)
        else:
            chosen = candidates[0] if candidates else cfg.default_model

        # 6. Budget constraint: downgrade if too expensive
        if effective_budget is not None:
            est_cost = self._estimate_cost(chosen, analysis.estimated_tokens)
            if est_cost > effective_budget * 0.5:
                cheaper = self._find_cheapest(candidates)
                if cheaper != chosen:
                    chosen = cheaper
                    budget_constrained = True

        # 7. Build justification
        justification = self._build_justification(
            task, complexity, detected_domain, chosen, analysis
        )

        return SmartRouteDecision(
            model=chosen,
            endpoint=cfg.default_endpoint,
            domain=detected_domain,
            complexity=complexity,
            justification=justification,
            budget_constrained=budget_constrained,
        )

    # ── RL Selection ────────────────────────────────────────────────────

    def _rl_select(
        self,
        candidates: list[str],
        domain: str,
    ) -> tuple[str, str]:
        if random.random() < self.epsilon:
            chosen = random.choice(candidates)
            return chosen, f"explore (epsilon={self.epsilon:.3f})"

        best_model = candidates[0]
        best_ucb = -float("inf")

        for model in candidates:
            score = self._compute_domain_score(model, domain)
            ucb = self._compute_ucb1(model, domain)
            total = score + ucb

            if total > best_ucb:
                best_ucb = total
                best_model = model

        return best_model, f"exploit (ucb={best_ucb:.3f})"

    def _compute_domain_score(self, model: str, domain: str) -> float:
        stats = self._get_stats(model, domain)
        if not stats or stats.total_runs == 0:
            return 0.5

        latency_norm = min(stats.avg_latency_ms / 10000, 1)
        cost_norm = min(stats.avg_cost_usd / 0.01, 1)

        return (
            self.weights["accuracy"] * stats.success_rate
            - self.weights["latency"] * latency_norm
            - self.weights["cost"] * cost_norm
        )

    def _compute_ucb1(self, model: str, domain: str) -> float:
        stats = self._get_stats(model, domain)
        if not stats or stats.total_runs == 0:
            return float("inf")
        if self._total_invocations == 0:
            return 0
        return self.ucb_c * math.sqrt(
            math.log(self._total_invocations) / stats.total_runs
        )

    def _get_stats(self, model: str, domain: str) -> DomainStats | None:
        key = f"{model}::{domain}"
        domain_stats = self._domain_stats.get(key)
        if domain_stats and domain_stats.total_runs > 0:
            return domain_stats
        return self._overall_stats.get(model)

    # ── Outcome Recording (RL feedback) ─────────────────────────────────

    def record_outcome(
        self,
        model: str,
        domain: str,
        success: bool,
        latency_ms: int,
        cost_usd: float,
    ) -> None:
        key = f"{model}::{domain}"
        if key not in self._domain_stats:
            self._domain_stats[key] = DomainStats()
        stats = self._domain_stats[key]
        stats.total_runs += 1
        if success:
            stats.successes += 1
        stats.total_latency_ms += latency_ms
        stats.total_cost_usd += cost_usd

        if model not in self._overall_stats:
            self._overall_stats[model] = DomainStats()
        overall = self._overall_stats[model]
        overall.total_runs += 1
        if success:
            overall.successes += 1
        overall.total_latency_ms += latency_ms
        overall.total_cost_usd += cost_usd

        self._total_invocations += 1
        self.spent_today_usd += cost_usd
        self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)

    # ── Cost Estimation ─────────────────────────────────────────────────

    def _estimate_cost(self, model: str, estimated_output_tokens: int) -> float:
        pricing = self._config.model_pricing.get(model, {"input": 3, "output": 15})
        input_tokens = estimated_output_tokens
        return (
            (input_tokens / 1_000_000 * pricing["input"])
            + (estimated_output_tokens / 1_000_000 * pricing["output"])
        )

    def _find_cheapest(self, candidates: list[str]) -> str:
        pricing = self._config.model_pricing
        return min(
            candidates,
            key=lambda m: pricing.get(m, {"output": 99})["output"],
        )

    # ── Justification ───────────────────────────────────────────────────

    def _build_justification(
        self,
        task: str,
        complexity: TaskComplexity,
        domain: str,
        chosen: str,
        analysis: Any,
    ) -> ModelJustification:
        cfg = self._config

        # Find cheapest alternative from config
        trivial_models = cfg.complexity_models.get("trivial", [cfg.default_model])
        alternative = trivial_models[0] if trivial_models else cfg.default_model

        est_tokens = analysis.estimated_tokens
        chosen_cost = self._estimate_cost(chosen, est_tokens)
        alt_cost = self._estimate_cost(alternative, est_tokens)

        savings = round((1 - alt_cost / chosen_cost) * 100, 1) if chosen_cost > 0 else 0.0
        quality_risk = _quality_risk(complexity, chosen, alternative)

        reasoning_parts = [
            f"{complexity.value.upper()} task in {domain} domain",
        ]
        if analysis.signals_found:
            reasoning_parts.append(f"signals: {', '.join(analysis.signals_found[:3])}")
        if complexity in (TaskComplexity.COMPLEX, TaskComplexity.FRONTIER):
            reasoning_parts.append("premium model justified for quality")
        elif complexity == TaskComplexity.TRIVIAL:
            reasoning_parts.append("efficient model sufficient")

        return ModelJustification(
            task_complexity=complexity,
            chosen_model=chosen,
            domain=domain,
            reasoning=" | ".join(reasoning_parts),
            estimated_cost=round(chosen_cost, 6),
            alternative_model=alternative,
            alternative_cost=round(alt_cost, 6),
            savings_percent=savings,
            quality_risk=quality_risk,
        )

    # ── Reports ─────────────────────────────────────────────────────────

    def get_rankings(self, domain: str = "general") -> list[dict]:
        models = list(self._config.model_pricing.keys())
        rankings = []
        for model in models:
            score = self._compute_domain_score(model, domain)
            ucb = score + self._compute_ucb1(model, domain)
            stats = self._get_stats(model, domain)
            rankings.append({
                "model": model,
                "domain": domain,
                "score": round(score, 3),
                "ucb": round(ucb, 3) if ucb != float("inf") else "inf",
                "runs": stats.total_runs if stats else 0,
                "success_rate": round(stats.success_rate, 2) if stats else 0,
                "avg_cost": round(stats.avg_cost_usd, 6) if stats else 0,
            })
        return sorted(rankings, key=lambda r: r["score"], reverse=True)

    def get_budget_status(self) -> dict:
        if not self.daily_budget_usd:
            return {"budget_set": False}
        remaining = self.daily_budget_usd - self.spent_today_usd
        return {
            "budget_set": True,
            "daily_budget_usd": self.daily_budget_usd,
            "spent_today_usd": round(self.spent_today_usd, 6),
            "remaining_usd": round(remaining, 6),
            "is_over_budget": remaining <= 0,
            "usage_percent": round(self.spent_today_usd / self.daily_budget_usd * 100, 1),
        }


# ── Helpers ─────────────────────────────────────────────────────────────────

def _tier_rank(tier: TaskComplexity) -> int:
    return {
        TaskComplexity.TRIVIAL: 0,
        TaskComplexity.STANDARD: 1,
        TaskComplexity.COMPLEX: 2,
        TaskComplexity.FRONTIER: 3,
    }[tier]


def _quality_risk(complexity: TaskComplexity, chosen: str, alternative: str) -> str:
    if chosen == alternative:
        return "none"
    if complexity == TaskComplexity.FRONTIER:
        return "significant: lower reasoning depth, may miss nuances in proofs/analysis"
    elif complexity == TaskComplexity.COMPLEX:
        return "moderate: may produce less optimal code or miss edge cases"
    elif complexity == TaskComplexity.STANDARD:
        return "low: output quality similar for straightforward tasks"
    else:
        return "minimal: cheap models handle trivial tasks equally well"
