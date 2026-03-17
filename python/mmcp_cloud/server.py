"""
MMCP Cloud — FastAPI proxy server.

Endpoints:
  POST /v1/auth/register          — create account
  POST /v1/auth/login             — get API key
  POST /v1/chat/completions       — proxy to OpenRouter with markup
  GET  /v1/account/usage          — usage stats
  GET  /v1/account/plan           — current plan + limits
  POST /v1/billing/checkout       — create Stripe checkout session
  POST /v1/billing/portal         — open Stripe billing portal
  POST /v1/billing/webhook        — Stripe webhook handler

Run:
  uvicorn mmcp_cloud.server:app --port 8765
"""
from __future__ import annotations
import os
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from .database import (
    init_db, create_user, authenticate_user, get_user_by_key,
    log_usage, get_usage, update_user_plan, get_user_by_email,
)
from .billing import (
    apply_markup, check_rate_limit, get_plan, get_month_start, PLANS,
    is_stripe_configured, create_checkout_session, create_billing_portal,
    handle_webhook_event,
)
from .streaming import register_stream_routes


# ── Lifespan ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="MMCP Cloud",
    version="1.1.0",
    description="MMCP proxy API gateway with usage-based billing + Stripe",
    lifespan=lifespan,
)

# Register SSE streaming routes
register_stream_routes(app)


# ── Auth helpers ────────────────────────────────────────────────────────────

def get_current_user(request: Request) -> dict:
    """Extract user from Authorization header."""
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer mmcp_"):
        raise HTTPException(401, "Invalid API key. Use 'mmcp login' to authenticate.")
    api_key = auth.replace("Bearer ", "")
    user = get_user_by_key(api_key)
    if not user:
        raise HTTPException(401, "Invalid or revoked API key.")
    return user


# ── Request/Response models ─────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    max_tokens: int = 4096
    temperature: float = 0.7


class CheckoutRequest(BaseModel):
    plan: str  # "pro" or "team"
    success_url: str = "https://mmcp.dev/billing/success"
    cancel_url: str = "https://mmcp.dev/billing/cancel"


# ── Auth endpoints ──────────────────────────────────────────────────────────

@app.post("/v1/auth/register")
async def register(req: RegisterRequest):
    """Create a new MMCP Cloud account."""
    if not req.email or not req.password:
        raise HTTPException(400, "Email and password required")
    if len(req.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    try:
        result = create_user(req.email, req.password)
        return {
            "status": "ok",
            "message": "Account created successfully",
            "api_key": result["api_key"],
            "plan": result["plan"],
        }
    except ValueError as e:
        raise HTTPException(409, str(e))


@app.post("/v1/auth/login")
async def login(req: LoginRequest):
    """Authenticate and get API key."""
    user = authenticate_user(req.email, req.password)
    if not user:
        raise HTTPException(401, "Invalid email or password")
    return {
        "status": "ok",
        "api_key": user["api_key"],
        "plan": user["plan"],
        "email": user["email"],
    }


# ── Proxy endpoint ──────────────────────────────────────────────────────────

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatRequest, request: Request):
    """Proxy chat completions to OpenRouter with markup + usage tracking."""
    user = get_current_user(request)

    # Check rate limit
    month_start = get_month_start()
    usage = get_usage(user["user_id"], since=month_start)
    limit_check = check_rate_limit(usage["runs"], user["plan"])

    if not limit_check["allowed"]:
        raise HTTPException(
            429,
            f"Monthly limit reached ({limit_check['limit']} runs on {limit_check['plan']} plan). "
            f"Upgrade at https://mmcp.dev/billing",
        )

    # Forward to OpenRouter
    or_key = os.environ.get("OPENROUTER_API_KEY")
    if not or_key:
        raise HTTPException(500, "Server misconfigured: no upstream API key")

    start = time.time()

    async with httpx.AsyncClient(timeout=120.0) as client:
        upstream_resp = await client.post(
            OPENROUTER_URL,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {or_key}",
                "HTTP-Referer": "https://mmcp.dev",
                "X-Title": "MMCP Cloud",
            },
            json={
                "model": req.model,
                "max_tokens": req.max_tokens,
                "temperature": req.temperature,
                "messages": [{"role": m.role, "content": m.content} for m in req.messages],
            },
        )

    if upstream_resp.status_code != 200:
        raise HTTPException(upstream_resp.status_code, upstream_resp.text)

    data = upstream_resp.json()
    duration_ms = int((time.time() - start) * 1000)

    # Extract usage
    upstream_usage = data.get("usage", {})
    input_tokens = upstream_usage.get("prompt_tokens", 0)
    output_tokens = upstream_usage.get("completion_tokens", 0)
    total_tokens = input_tokens + output_tokens

    # Calculate cost with markup
    upstream_cost = upstream_usage.get("cost", 0) or 0
    billed_cost = apply_markup(upstream_cost, user["plan"])

    # Log usage
    log_usage(
        user_id=user["user_id"],
        tokens=total_tokens,
        cost_usd=billed_cost,
        model=req.model,
        pipeline="chat",
    )

    # Return response with billing info
    data["mmcp_billing"] = {
        "upstream_cost": upstream_cost,
        "billed_cost": billed_cost,
        "plan": user["plan"],
        "runs_remaining": limit_check["remaining"],
        "duration_ms": duration_ms,
    }

    return data


# ── Account endpoints ───────────────────────────────────────────────────────

@app.get("/v1/account/usage")
async def account_usage(request: Request):
    """Get usage stats for the current billing period."""
    user = get_current_user(request)
    month_start = get_month_start()

    monthly = get_usage(user["user_id"], since=month_start)
    total = get_usage(user["user_id"])
    limit_check = check_rate_limit(monthly["runs"], user["plan"])

    return {
        "email": user["email"],
        "plan": user["plan"],
        "this_month": {
            "runs": monthly["runs"],
            "tokens": monthly["tokens"],
            "cost_usd": round(monthly["cost_usd"], 6),
            "remaining": limit_check["remaining"],
            "limit": limit_check["limit"],
        },
        "all_time": {
            "runs": total["runs"],
            "tokens": total["tokens"],
            "cost_usd": round(total["cost_usd"], 6),
        },
    }


@app.get("/v1/account/plan")
async def account_plan(request: Request):
    """Get current plan details."""
    user = get_current_user(request)
    plan = get_plan(user["plan"])
    return {
        "email": user["email"],
        "plan_id": user["plan"],
        "plan_name": plan["name"],
        "price_usd": plan["price_usd"],
        "runs_per_month": plan["runs_per_month"],
        "markup_pct": int(plan["markup"] * 100),
        "available_plans": {
            pid: {"name": p["name"], "price": p["price_usd"], "runs": p["runs_per_month"]}
            for pid, p in PLANS.items()
        },
    }


# ── Stripe billing endpoints ───────────────────────────────────────────────

@app.post("/v1/billing/checkout")
async def billing_checkout(req: CheckoutRequest, request: Request):
    """Create a Stripe Checkout session for plan upgrade."""
    if not is_stripe_configured():
        raise HTTPException(503, "Stripe billing not configured on this server")

    user = get_current_user(request)

    if req.plan not in ("pro", "team"):
        raise HTTPException(400, "Invalid plan. Choose 'pro' or 'team'.")

    if user["plan"] == req.plan:
        raise HTTPException(400, f"Already on {req.plan} plan.")

    try:
        checkout_url = create_checkout_session(
            email=user["email"],
            plan_id=req.plan,
            success_url=req.success_url,
            cancel_url=req.cancel_url,
        )
        return {"status": "ok", "checkout_url": checkout_url}
    except Exception as e:
        raise HTTPException(500, f"Failed to create checkout: {e}")


@app.post("/v1/billing/portal")
async def billing_portal(request: Request):
    """Open the Stripe Billing Portal for subscription management."""
    if not is_stripe_configured():
        raise HTTPException(503, "Stripe billing not configured on this server")

    user = get_current_user(request)
    user_data = get_user_by_email(user["email"])

    if not user_data or not user_data.get("stripe_customer_id"):
        raise HTTPException(400, "No active subscription. Use /v1/billing/checkout first.")

    try:
        portal_url = create_billing_portal(
            stripe_customer_id=user_data["stripe_customer_id"],
            return_url="https://mmcp.dev/account",
        )
        return {"status": "ok", "portal_url": portal_url}
    except Exception as e:
        raise HTTPException(500, f"Failed to create portal session: {e}")


@app.post("/v1/billing/webhook")
async def billing_webhook(request: Request):
    """Handle Stripe webhook events for subscription lifecycle."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    try:
        result = handle_webhook_event(payload, sig)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if result.get("handled"):
        email = result.get("email", "")
        customer_id = result.get("customer_id", "")
        plan = result.get("plan", "free")

        # Find user and update plan
        if email:
            user = get_user_by_email(email)
            if user:
                update_user_plan(user["id"], plan, stripe_customer_id=customer_id)
        elif customer_id:
            # For subscription updates/deletions, find user by stripe_customer_id
            # This is handled by searching the database
            from .database import _get_db, _fetchone
            conn = _get_db()
            row = _fetchone(conn, "SELECT id FROM users WHERE stripe_customer_id = ?", (customer_id,))
            conn.close()
            if row:
                update_user_plan(row["id"], plan)

    return {"status": "ok", "event_type": result["event_type"]}


# ── Health ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    from .database import USE_POSTGRES
    return {
        "status": "ok",
        "service": "mmcp-cloud",
        "version": "1.1.0",
        "database": "postgresql" if USE_POSTGRES else "sqlite",
        "stripe": is_stripe_configured(),
    }
