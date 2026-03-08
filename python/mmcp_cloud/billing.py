"""
MMCP Cloud — Billing & rate limiting.

Plans:
  free   — 50 runs/month
  pro    — 500 runs/month    ($19/mo)
  team   — unlimited         ($49/mo)

Markup: 15% on top of upstream token costs.
"""
from __future__ import annotations
from datetime import datetime, timezone


PLANS: dict[str, dict] = {
    "free": {
        "name": "Free",
        "runs_per_month": 50,
        "price_usd": 0,
        "markup": 0.15,
    },
    "pro": {
        "name": "Pro",
        "runs_per_month": 500,
        "price_usd": 19,
        "markup": 0.15,
    },
    "team": {
        "name": "Team",
        "runs_per_month": -1,  # unlimited
        "price_usd": 49,
        "markup": 0.10,  # lower markup for higher tier
    },
}

MARKUP_DEFAULT = 0.15


def get_plan(plan_id: str) -> dict:
    return PLANS.get(plan_id, PLANS["free"])


def apply_markup(cost_usd: float, plan_id: str = "free") -> float:
    """Apply billing markup to upstream cost."""
    plan = get_plan(plan_id)
    markup = plan.get("markup", MARKUP_DEFAULT)
    return round(cost_usd * (1 + markup), 8)


def check_rate_limit(runs_this_month: int, plan_id: str) -> dict:
    """Check if user is within their plan limits."""
    plan = get_plan(plan_id)
    limit = plan["runs_per_month"]

    if limit == -1:  # unlimited
        return {"allowed": True, "remaining": -1, "limit": -1}

    remaining = max(0, limit - runs_this_month)
    return {
        "allowed": runs_this_month < limit,
        "remaining": remaining,
        "limit": limit,
        "plan": plan["name"],
    }


def get_month_start() -> str:
    """Get ISO string for the start of the current month (UTC)."""
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
