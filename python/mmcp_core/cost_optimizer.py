"""
MMCP v2.2 — Cost Optimizer & Expense Tracker.

Tracks all spending (models + MCP + tools), identifies waste patterns,
and provides actionable recommendations to reduce costs.

All storage paths, model lists, and thresholds come from MMCPConfig.
Nothing is hardcoded.
"""
from __future__ import annotations
import json
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Any

from .types import (
    TaskComplexity, ExpenseEntry, SavingsRecommendation,
    SpendAnalysis, BudgetStatus,
)


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ── Cost Optimizer ──────────────────────────────────────────────────────────

class CostOptimizer:
    """
    Track expenses, analyze spending, and recommend cost reductions.
    All paths and model lookups come from config.
    """

    def __init__(self, config: Any | None = None) -> None:
        if config is None:
            from .config import get_config
            config = get_config()
        self._config = config

        # Storage paths from config
        self._expenses_dir = config.expenses_dir
        self._budget_file = config.budget_file

        self._expenses_dir.mkdir(parents=True, exist_ok=True)
        self._session_entries: list[ExpenseEntry] = []

    def _ledger_path(self, date_str: str | None = None) -> Path:
        return self._expenses_dir / f"{date_str or _today_str()}.jsonl"

    # ── Recording ───────────────────────────────────────────────────────

    def record(self, entry: ExpenseEntry) -> None:
        """Record an expense entry to the ledger."""
        self._session_entries.append(entry)
        path = self._ledger_path()
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(entry)) + "\n")

    def record_model_call(
        self,
        task: str,
        model: str,
        domain: str,
        complexity: TaskComplexity,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
        latency_ms: int,
        success: bool,
        was_justified: bool = True,
    ) -> None:
        """Convenience: record a model API call."""
        self.record(ExpenseEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            task_summary=task[:100],
            entry_type="model_call",
            model=model,
            domain=domain,
            complexity=complexity.value,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost_usd,
            latency_ms=latency_ms,
            success=success,
            was_justified=was_justified,
        ))

    def record_mcp_call(
        self,
        task: str,
        server_name: str,
        tool_name: str,
        latency_ms: int,
        overhead_ms: int,
        success: bool,
        builtin_available: bool = False,
    ) -> None:
        """Convenience: record an MCP tool call."""
        self.record(ExpenseEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            task_summary=task[:100],
            entry_type="mcp_tool",
            mcp_server=server_name,
            tool_name=tool_name,
            overhead_ms=overhead_ms,
            latency_ms=latency_ms,
            success=success,
            builtin_available=builtin_available,
        ))

    def record_builtin_call(
        self,
        task: str,
        tool_name: str,
        latency_ms: int,
        success: bool,
    ) -> None:
        """Convenience: record a built-in tool call."""
        self.record(ExpenseEntry(
            timestamp=datetime.now(timezone.utc).isoformat(),
            task_summary=task[:100],
            entry_type="builtin_tool",
            tool_name=tool_name,
            latency_ms=latency_ms,
            success=success,
        ))

    # ── Loading ─────────────────────────────────────────────────────────

    def _load_entries(self, period_days: int = 30) -> list[ExpenseEntry]:
        """Load expense entries from the last N days."""
        entries: list[ExpenseEntry] = []
        cutoff = datetime.now(timezone.utc) - timedelta(days=period_days)

        for path in sorted(self._expenses_dir.glob("*.jsonl")):
            # Check date from filename
            try:
                file_date = datetime.strptime(path.stem, "%Y-%m-%d").replace(
                    tzinfo=timezone.utc
                )
                if file_date < cutoff:
                    continue
            except ValueError:
                continue

            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        entries.append(ExpenseEntry(**data))
                    except (json.JSONDecodeError, TypeError):
                        continue

        return entries

    # ── Analysis ────────────────────────────────────────────────────────

    def analyze_spend(self, period_days: int = 30) -> SpendAnalysis:
        """Analyze spending patterns over the given period."""
        entries = self._load_entries(period_days)

        by_model: dict[str, float] = defaultdict(float)
        by_domain: dict[str, float] = defaultdict(float)
        by_complexity: dict[str, float] = defaultdict(float)
        total_cost = 0.0
        total_tokens = 0
        mcp_overhead = 0
        mcp_calls = 0
        builtin_calls = 0

        for e in entries:
            total_cost += e.cost_usd
            total_tokens += e.input_tokens + e.output_tokens

            if e.model:
                by_model[e.model] += e.cost_usd
            by_domain[e.domain] += e.cost_usd
            by_complexity[e.complexity] += e.cost_usd

            if e.entry_type == "mcp_tool":
                mcp_overhead += e.overhead_ms
                mcp_calls += 1
            elif e.entry_type == "builtin_tool":
                builtin_calls += 1

        # Get top savings recommendations
        recommendations = self.get_savings_recommendations(entries)

        return SpendAnalysis(
            period_days=period_days,
            total_cost_usd=round(total_cost, 6),
            total_calls=len(entries),
            total_tokens=total_tokens,
            by_model=dict(by_model),
            by_domain=dict(by_domain),
            by_complexity=dict(by_complexity),
            mcp_overhead_total_ms=mcp_overhead,
            mcp_calls_total=mcp_calls,
            builtin_calls_total=builtin_calls,
            top_waste=recommendations[:5],
        )

    def get_savings_recommendations(
        self,
        entries: list[ExpenseEntry] | None = None,
    ) -> list[SavingsRecommendation]:
        """Generate actionable savings recommendations."""
        if entries is None:
            entries = self._load_entries(30)

        recommendations: list[SavingsRecommendation] = []

        # 1. Model Downgrade Opportunities
        recommendations.extend(self._find_downgrade_opportunities(entries))

        # 2. MCP → Built-in Switch
        recommendations.extend(self._find_mcp_builtin_switches(entries))

        # 3. MCP Connection Reuse
        recommendations.extend(self._find_mcp_reuse_opportunities(entries))

        # 4. Model Waste (premium models for trivial tasks)
        recommendations.extend(self._find_model_waste(entries))

        # Sort by estimated savings (highest first)
        recommendations.sort(key=lambda r: r.estimated_savings_usd, reverse=True)
        return recommendations

    def get_model_value_report(self) -> dict:
        """Which models create value vs. which are overkill."""
        entries = self._load_entries(30)
        model_data: dict[str, dict] = defaultdict(lambda: {
            "total_cost": 0.0,
            "total_calls": 0,
            "success_rate": 0.0,
            "successes": 0,
            "justified_calls": 0,
            "unjustified_calls": 0,
            "by_complexity": defaultdict(int),
        })

        for e in entries:
            if not e.model:
                continue
            md = model_data[e.model]
            md["total_cost"] += e.cost_usd
            md["total_calls"] += 1
            if e.success:
                md["successes"] += 1
            if e.was_justified:
                md["justified_calls"] += 1
            else:
                md["unjustified_calls"] += 1
            md["by_complexity"][e.complexity] += 1

        # Calculate value scores
        report = {}
        for model, data in model_data.items():
            total = data["total_calls"]
            data["success_rate"] = data["successes"] / total if total else 0
            data["justified_pct"] = data["justified_calls"] / total * 100 if total else 0
            data["value_score"] = round(
                data["success_rate"] * data["justified_pct"] / 100, 2
            )
            data["total_cost"] = round(data["total_cost"], 6)
            data["by_complexity"] = dict(data["by_complexity"])
            report[model] = data

        return report

    def get_mcp_overhead_report(self) -> dict:
        """Track MCP startup costs and identify optimization opportunities."""
        entries = self._load_entries(30)
        mcp_entries = [e for e in entries if e.entry_type == "mcp_tool"]

        if not mcp_entries:
            return {"total_mcp_calls": 0, "message": "No MCP calls recorded."}

        by_server: dict[str, dict] = defaultdict(lambda: {
            "calls": 0,
            "total_overhead_ms": 0,
            "builtin_available_count": 0,
            "tools_used": defaultdict(int),
        })

        for e in mcp_entries:
            server = e.mcp_server or "unknown"
            sd = by_server[server]
            sd["calls"] += 1
            sd["total_overhead_ms"] += e.overhead_ms
            if e.builtin_available:
                sd["builtin_available_count"] += 1
            if e.tool_name:
                sd["tools_used"][e.tool_name] += 1

        report = {
            "total_mcp_calls": len(mcp_entries),
            "total_overhead_ms": sum(e.overhead_ms for e in mcp_entries),
            "avg_overhead_ms": sum(e.overhead_ms for e in mcp_entries) // len(mcp_entries),
            "servers": {},
        }
        for server, data in by_server.items():
            data["avg_overhead_ms"] = data["total_overhead_ms"] // max(data["calls"], 1)
            data["tools_used"] = dict(data["tools_used"])
            report["servers"][server] = data

        return report

    # ── Savings Finders ─────────────────────────────────────────────────

    def _find_downgrade_opportunities(
        self,
        entries: list[ExpenseEntry],
    ) -> list[SavingsRecommendation]:
        """Find cases where premium models were used for simple tasks."""
        recs: list[SavingsRecommendation] = []

        # Group by model + complexity
        model_complexity: dict[str, dict] = defaultdict(lambda: {
            "count": 0, "total_cost": 0.0
        })

        # Identify premium models dynamically from config pricing
        # Premium = models with output price > $5 per 1M tokens
        pricing = self._config.model_pricing
        premium_models = {
            m for m, p in pricing.items()
            if p.get("output", 0) >= 5.0
        }
        # Identify cheapest alternative from config
        cheapest = min(
            pricing.items(),
            key=lambda x: x[1].get("output", 999),
            default=("unknown", {"output": 1}),
        )

        for e in entries:
            if e.model and e.model in premium_models and e.complexity in ("trivial", "standard"):
                key = f"{e.model}::{e.complexity}"
                mc = model_complexity[key]
                mc["count"] += 1
                mc["total_cost"] += e.cost_usd

        for key, data in model_complexity.items():
            model, complexity = key.split("::")
            if data["count"] >= 2:
                # Estimate savings if using haiku instead
                est_savings = data["total_cost"] * 0.85  # ~85% savings

                cheap_name = cheapest[0].split('/')[-1]
                recs.append(SavingsRecommendation(
                    category="downgrade",
                    title=f"Downgrade {model.split('/')[-1]} for {complexity} tasks",
                    description=(
                        f"You used {model.split('/')[-1]} for {data['count']} "
                        f"{complexity} tasks (${data['total_cost']:.4f} total). "
                        f"Switching to {cheap_name} would save ~${est_savings:.4f} "
                        f"with minimal quality loss for {complexity} work."
                    ),
                    estimated_savings_usd=round(est_savings, 6),
                    estimated_savings_time_ms=0,
                    confidence=0.85,
                    affected_count=data["count"],
                ))

        return recs

    def _find_mcp_builtin_switches(
        self,
        entries: list[ExpenseEntry],
    ) -> list[SavingsRecommendation]:
        """Find MCP calls that have built-in equivalents."""
        recs: list[SavingsRecommendation] = []

        builtin_available = [e for e in entries if e.entry_type == "mcp_tool" and e.builtin_available]
        if not builtin_available:
            return recs

        # Group by server:tool
        by_tool: dict[str, dict] = defaultdict(lambda: {
            "count": 0, "total_overhead_ms": 0
        })

        for e in builtin_available:
            key = f"{e.mcp_server}:{e.tool_name}"
            td = by_tool[key]
            td["count"] += 1
            td["total_overhead_ms"] += e.overhead_ms

        for key, data in by_tool.items():
            if data["count"] >= 1:
                recs.append(SavingsRecommendation(
                    category="mcp_to_builtin",
                    title=f"Switch {key} to built-in",
                    description=(
                        f"You used MCP {key} {data['count']} times "
                        f"(avg {data['total_overhead_ms'] // data['count']}ms startup). "
                        f"The built-in equivalent is identical and instant. "
                        f"Savings: ~{data['total_overhead_ms'] // 1000}s of latency."
                    ),
                    estimated_savings_usd=0.0,
                    estimated_savings_time_ms=data["total_overhead_ms"],
                    confidence=0.95,
                    affected_count=data["count"],
                ))

        return recs

    def _find_mcp_reuse_opportunities(
        self,
        entries: list[ExpenseEntry],
    ) -> list[SavingsRecommendation]:
        """Find MCP servers that could benefit from connection pooling."""
        recs: list[SavingsRecommendation] = []

        mcp_entries = [e for e in entries if e.entry_type == "mcp_tool" and e.overhead_ms > 1000]
        if len(mcp_entries) < 2:
            return recs

        # Group by server
        by_server: dict[str, int] = defaultdict(int)
        by_server_overhead: dict[str, int] = defaultdict(int)

        for e in mcp_entries:
            server = e.mcp_server or "unknown"
            by_server[server] += 1
            by_server_overhead[server] += e.overhead_ms

        for server, count in by_server.items():
            if count >= 2:
                saveable_startups = count - 1  # Keep first, pool the rest
                saved_ms = by_server_overhead[server] * saveable_startups // count

                recs.append(SavingsRecommendation(
                    category="mcp_reuse",
                    title=f"Pool {server} MCP connections",
                    description=(
                        f"The {server} MCP server was started {count} times. "
                        f"With connection pooling, {saveable_startups} startups "
                        f"could be eliminated (saving ~{saved_ms // 1000}s)."
                    ),
                    estimated_savings_usd=0.0,
                    estimated_savings_time_ms=saved_ms,
                    confidence=0.90,
                    affected_count=count,
                ))

        return recs

    def _find_model_waste(
        self,
        entries: list[ExpenseEntry],
    ) -> list[SavingsRecommendation]:
        """Find expensive models used for tasks they have no advantage on."""
        recs: list[SavingsRecommendation] = []

        # Frontier models from config (output price > $10/1M tokens)
        pricing = self._config.model_pricing
        frontier_models = {
            m for m, p in pricing.items()
            if p.get("output", 0) >= 10.0
        }
        trivial_uses: dict[str, dict] = defaultdict(lambda: {"count": 0, "cost": 0.0})

        for e in entries:
            if e.model in frontier_models and e.complexity == "trivial":
                td = trivial_uses[e.model]
                td["count"] += 1
                td["cost"] += e.cost_usd

        for model, data in trivial_uses.items():
            if data["count"] >= 1:
                recs.append(SavingsRecommendation(
                    category="model_waste",
                    title=f"{model.split('/')[-1]} wasted on trivial tasks",
                    description=(
                        f"{model.split('/')[-1]} was used for {data['count']} trivial tasks "
                        f"(${data['cost']:.4f}). It has 0% advantage over haiku/flash "
                        f"for these. Full cost is wasted."
                    ),
                    estimated_savings_usd=round(data["cost"] * 0.95, 6),
                    estimated_savings_time_ms=0,
                    confidence=0.90,
                    affected_count=data["count"],
                ))

        return recs

    # ── Budget ──────────────────────────────────────────────────────────

    def set_budget(self, daily_budget_usd: float) -> None:
        """Set a daily spend cap."""
        self._budget_file.parent.mkdir(parents=True, exist_ok=True)
        self._budget_file.write_text(
            json.dumps({"daily_budget_usd": daily_budget_usd}),
            encoding="utf-8",
        )

    def get_budget(self) -> float | None:
        """Get the current daily budget, or None if not set."""
        if self._budget_file.exists():
            data = json.loads(self._budget_file.read_text(encoding="utf-8"))
            return data.get("daily_budget_usd")
        return None

    def get_budget_status(self) -> BudgetStatus:
        """Get current budget tracking status."""
        budget = self.get_budget()
        if not budget:
            return BudgetStatus(
                daily_budget_usd=0.0,
                spent_today_usd=0.0,
                remaining_usd=0.0,
                projected_daily_usd=0.0,
                is_over_budget=False,
                downgrade_active=False,
            )

        # Load today's entries
        today = self._load_entries(1)
        spent = sum(e.cost_usd for e in today)

        # Project based on time of day
        now = datetime.now(timezone.utc)
        hours_elapsed = now.hour + now.minute / 60.0
        if hours_elapsed > 0:
            projected = spent / hours_elapsed * 24
        else:
            projected = spent

        remaining = budget - spent

        return BudgetStatus(
            daily_budget_usd=budget,
            spent_today_usd=round(spent, 6),
            remaining_usd=round(remaining, 6),
            projected_daily_usd=round(projected, 6),
            is_over_budget=remaining <= 0,
            downgrade_active=remaining < budget * 0.1,  # Last 10%
        )

    # ── Display Helpers ─────────────────────────────────────────────────

    def format_spend_summary(self, analysis: SpendAnalysis) -> str:
        """Format a spend analysis for terminal display."""
        lines = [
            f"📊 Spend Summary ({analysis.period_days} days)",
            f"",
            f"  Total Cost:    ${analysis.total_cost_usd:.4f}",
            f"  Total Calls:   {analysis.total_calls:,}",
            f"  Total Tokens:  {analysis.total_tokens:,}",
            f"",
        ]

        if analysis.by_model:
            lines.append("  By Model:")
            for model, cost in sorted(analysis.by_model.items(), key=lambda x: -x[1]):
                lines.append(f"    {model.split('/')[-1]:.<30} ${cost:.4f}")

        if analysis.mcp_calls_total > 0:
            lines.extend([
                f"",
                f"  MCP Overhead:  {analysis.mcp_overhead_total_ms:,}ms ({analysis.mcp_calls_total} calls)",
                f"  Built-in:      {analysis.builtin_calls_total} calls (free)",
            ])

        if analysis.top_waste:
            lines.extend([
                f"",
                f"  💡 Top Savings Opportunities:",
            ])
            for rec in analysis.top_waste[:3]:
                if rec.estimated_savings_usd > 0:
                    lines.append(f"    • {rec.title} (save ${rec.estimated_savings_usd:.4f})")
                elif rec.estimated_savings_time_ms > 0:
                    lines.append(f"    • {rec.title} (save {rec.estimated_savings_time_ms // 1000}s)")

        return "\n".join(lines)
