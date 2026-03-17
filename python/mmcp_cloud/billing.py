"""
MMCP Cloud — Billing & rate limiting with Stripe integration.

Plans:
  free   — 50 runs/month
  pro    — 500 runs/month    ($19/mo)
  team   — unlimited         ($49/mo)

Markup: 15% on top of upstream token costs.

Stripe integration:
  Set STRIPE_SECRET_KEY, STRIPE_PRICE_PRO, STRIPE_PRICE_TEAM, STRIPE_WEBHOOK_SECRET
  to enable subscription billing.
"""
from __future__ import annotations
import os
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


# ── Stripe integration ─────────────────────────────────────────────────────

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PRICE_PRO = os.environ.get("STRIPE_PRICE_PRO", "")
STRIPE_PRICE_TEAM = os.environ.get("STRIPE_PRICE_TEAM", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

_stripe = None

def _get_stripe():
    """Lazy-load Stripe SDK."""
    global _stripe
    if _stripe is None:
        try:
            import stripe
            stripe.api_key = STRIPE_SECRET_KEY
            _stripe = stripe
        except ImportError:
            raise RuntimeError("stripe package not installed. Run: pip install stripe")
    return _stripe


def is_stripe_configured() -> bool:
    """Check if Stripe credentials are set."""
    return bool(STRIPE_SECRET_KEY and STRIPE_PRICE_PRO)


def create_checkout_session(email: str, plan_id: str, success_url: str, cancel_url: str) -> str:
    """Create a Stripe Checkout session for subscription.
    
    Returns the checkout URL.
    """
    stripe = _get_stripe()

    price_map = {
        "pro": STRIPE_PRICE_PRO,
        "team": STRIPE_PRICE_TEAM,
    }
    price_id = price_map.get(plan_id)
    if not price_id:
        raise ValueError(f"No Stripe price configured for plan '{plan_id}'")

    session = stripe.checkout.Session.create(
        customer_email=email,
        payment_method_types=["card"],
        line_items=[{"price": price_id, "quantity": 1}],
        mode="subscription",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"mmcp_plan": plan_id},
    )
    return session.url


def create_billing_portal(stripe_customer_id: str, return_url: str) -> str:
    """Create a Stripe Billing Portal session for managing subscriptions.
    
    Returns the portal URL.
    """
    stripe = _get_stripe()
    session = stripe.billing_portal.Session.create(
        customer=stripe_customer_id,
        return_url=return_url,
    )
    return session.url


def handle_webhook_event(payload: bytes, sig_header: str) -> dict:
    """Verify and process a Stripe webhook event.
    
    Returns:
        dict with 'event_type', 'email', 'plan', 'customer_id' if relevant.
    """
    stripe = _get_stripe()

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise ValueError("Invalid Stripe webhook signature")

    result = {"event_type": event["type"], "handled": False}

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        result.update({
            "handled": True,
            "email": session.get("customer_email", ""),
            "customer_id": session.get("customer", ""),
            "plan": session.get("metadata", {}).get("mmcp_plan", "pro"),
        })

    elif event["type"] == "customer.subscription.deleted":
        sub = event["data"]["object"]
        result.update({
            "handled": True,
            "customer_id": sub.get("customer", ""),
            "plan": "free",  # downgrade on cancellation
        })

    elif event["type"] == "customer.subscription.updated":
        sub = event["data"]["object"]
        # Check if subscription is active or past_due
        status = sub.get("status", "")
        if status in ("active", "past_due"):
            plan_id = sub.get("metadata", {}).get("mmcp_plan", "pro")
        else:
            plan_id = "free"
        result.update({
            "handled": True,
            "customer_id": sub.get("customer", ""),
            "plan": plan_id,
        })

    return result
