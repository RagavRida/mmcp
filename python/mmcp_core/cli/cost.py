"""MMCP CLI — Cost management subcommand (v2.2)."""
from __future__ import annotations
import argparse

from ._common import (
    _banner, _load_env,
    BOLD, DIM, GREEN, YELLOW, RED, CYAN, RESET,
)


def cmd_cost(args: argparse.Namespace) -> None:
    """Show spend summary, savings recommendations, or manage budget."""
    _load_env()

    from ..cost_optimizer import CostOptimizer

    optimizer = CostOptimizer()
    sub = getattr(args, "cost_action", None)

    if sub == "savings":
        _show_savings(optimizer)
    elif sub == "budget":
        budget_val = getattr(args, "budget_value", None)
        if budget_val is not None:
            _set_budget(optimizer, budget_val)
        else:
            _show_budget(optimizer)
    elif sub == "report":
        _show_value_report(optimizer)
    elif sub == "mcp":
        _show_mcp_report(optimizer)
    else:
        _show_spend_summary(optimizer)


def _show_spend_summary(optimizer) -> None:
    """Show spending summary."""
    _banner("Cost Summary")
    analysis = optimizer.analyze_spend(period_days=30)
    print(optimizer.format_spend_summary(analysis))

    if analysis.total_calls == 0:
        print(f"\n  {DIM}No expenses recorded yet. Run 'mmcp auto' to start.{RESET}")


def _show_savings(optimizer) -> None:
    """Show savings recommendations."""
    _banner("Savings Recommendations")
    recs = optimizer.get_savings_recommendations()

    if not recs:
        print(f"  {GREEN}✅ No obvious savings found. You're running efficiently!{RESET}")
        return

    for i, rec in enumerate(recs, 1):
        icon = {
            "downgrade": "📉",
            "mcp_to_builtin": "⚡",
            "mcp_reuse": "🔌",
            "cache": "💾",
            "model_waste": "🗑️",
        }.get(rec.category, "💡")

        print(f"\n  {CYAN}{i}.{RESET} {icon} {BOLD}{rec.title}{RESET}")
        print(f"     {rec.description}")
        if rec.estimated_savings_usd > 0:
            print(f"     {GREEN}Save: ${rec.estimated_savings_usd:.4f}{RESET} ({rec.affected_count} calls)")
        if rec.estimated_savings_time_ms > 0:
            print(f"     {GREEN}Save: {rec.estimated_savings_time_ms // 1000}s latency{RESET} ({rec.affected_count} calls)")
        print(f"     {DIM}Confidence: {rec.confidence:.0%}{RESET}")


def _set_budget(optimizer, amount: float) -> None:
    """Set daily budget."""
    optimizer.set_budget(amount)
    print(f"  {GREEN}✅ Daily budget set to ${amount:.2f}{RESET}")
    print(f"  {DIM}Models will auto-downgrade when approaching the limit.{RESET}")


def _show_budget(optimizer) -> None:
    """Show current budget status."""
    status = optimizer.get_budget_status()
    if status.daily_budget_usd == 0:
        print(f"  {DIM}No budget set. Use 'mmcp cost budget <amount>' to set one.{RESET}")
        return

    _banner("Budget Status")
    pct = (status.spent_today_usd / status.daily_budget_usd * 100) if status.daily_budget_usd else 0

    bar_len = 30
    filled = int(bar_len * min(pct / 100, 1))
    bar_color = GREEN if pct < 70 else (YELLOW if pct < 90 else RED)
    bar = f"{bar_color}{'█' * filled}{RESET}{'░' * (bar_len - filled)}"

    print(f"  Budget:    ${status.daily_budget_usd:.2f}/day")
    print(f"  Spent:     ${status.spent_today_usd:.4f}")
    print(f"  Remaining: ${status.remaining_usd:.4f}")
    print(f"  Usage:     {bar} {pct:.1f}%")
    print(f"  Projected: ${status.projected_daily_usd:.4f}/day")

    if status.is_over_budget:
        print(f"\n  {RED}⚠️  OVER BUDGET — models will be auto-downgraded{RESET}")
    elif status.downgrade_active:
        print(f"\n  {YELLOW}⚠️  Approaching limit — soft downgrades active{RESET}")


def _show_value_report(optimizer) -> None:
    """Show model value report."""
    _banner("Model Value Report")
    report = optimizer.get_model_value_report()

    if not report:
        print(f"  {DIM}No model data yet. Run some tasks first.{RESET}")
        return

    # Header
    print(f"  {'Model':<35} {'Calls':>6} {'Cost':>10} {'Success':>8} {'Value':>7}")
    print(f"  {'─' * 35} {'─' * 6} {'─' * 10} {'─' * 8} {'─' * 7}")

    for model, data in sorted(report.items(), key=lambda x: -x[1]["value_score"]):
        name = model.split("/")[-1]
        calls = data["total_calls"]
        cost = data["total_cost"]
        sr = data["success_rate"]
        vs = data["value_score"]

        # Color by value score
        color = GREEN if vs > 0.7 else (YELLOW if vs > 0.4 else RED)
        print(f"  {name:<35} {calls:>6} ${cost:>9.4f} {sr:>7.0%} {color}{vs:>6.2f}{RESET}")

        # Show complexity breakdown
        by_cx = data.get("by_complexity", {})
        if by_cx:
            cx_parts = [f"{k}={v}" for k, v in by_cx.items()]
            print(f"  {DIM}{'':>35} {' '.join(cx_parts)}{RESET}")


def _show_mcp_report(optimizer) -> None:
    """Show MCP overhead report."""
    _banner("MCP Overhead Report")
    report = optimizer.get_mcp_overhead_report()

    if report.get("total_mcp_calls", 0) == 0:
        print(f"  {DIM}No MCP calls recorded.{RESET}")
        return

    print(f"  Total MCP calls: {report['total_mcp_calls']}")
    print(f"  Total overhead:  {report['total_overhead_ms']:,}ms")
    print(f"  Avg overhead:    {report['avg_overhead_ms']:,}ms")

    for server, data in report.get("servers", {}).items():
        print(f"\n  {CYAN}{server}{RESET}:")
        print(f"    Calls: {data['calls']}")
        print(f"    Total overhead: {data['total_overhead_ms']:,}ms")
        if data.get("builtin_available_count", 0):
            print(f"    {YELLOW}⚠️  {data['builtin_available_count']} calls had built-in equivalents!{RESET}")
