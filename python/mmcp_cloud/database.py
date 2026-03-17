"""
MMCP Cloud — Database layer.

Supports both SQLite (local dev) and PostgreSQL (production).
Set DATABASE_URL for PostgreSQL, otherwise falls back to SQLite.

Tables:
  users     — email, hashed password, plan, stripe_customer_id
  api_keys  — key, user_id, created_at, revoked
  usage     — user_id, tokens, cost, model, timestamp
"""
from __future__ import annotations
import hashlib
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ── Backend detection ───────────────────────────────────────────────────────

DATABASE_URL = os.environ.get("DATABASE_URL", "")
USE_POSTGRES = DATABASE_URL.startswith("postgres")

if USE_POSTGRES:
    import psycopg2
    import psycopg2.extras
else:
    import sqlite3

DB_PATH = os.environ.get("MMCP_DB_PATH", str(Path.home() / ".mmcp" / "cloud.db"))


def _get_db():
    """Get a database connection (SQLite or PostgreSQL)."""
    if USE_POSTGRES:
        conn = psycopg2.connect(DATABASE_URL)
        conn.autocommit = False
        return conn
    else:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn


def _execute(conn, query: str, params: tuple = ()) -> Any:
    """Execute a query with backend-appropriate placeholder syntax."""
    if USE_POSTGRES:
        # Convert ? placeholders to %s for psycopg2
        query = query.replace("?", "%s")
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    else:
        cur = conn.cursor()
    cur.execute(query, params)
    return cur


def _fetchone(conn, query: str, params: tuple = ()) -> dict | None:
    """Execute and fetch one row as dict."""
    cur = _execute(conn, query, params)
    row = cur.fetchone()
    if row is None:
        return None
    if USE_POSTGRES:
        return dict(row)
    else:
        return dict(row)


def _fetchall(conn, query: str, params: tuple = ()) -> list[dict]:
    """Execute and fetch all rows as dicts."""
    cur = _execute(conn, query, params)
    rows = cur.fetchall()
    if USE_POSTGRES:
        return [dict(r) for r in rows]
    else:
        return [dict(r) for r in rows]


# ── Schema ──────────────────────────────────────────────────────────────────

_SQLITE_SCHEMA = """
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        stripe_customer_id TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        name TEXT DEFAULT 'default',
        created_at TEXT NOT NULL,
        revoked INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0.0,
        model TEXT,
        pipeline TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_usage_user ON usage(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_date ON usage(created_at);
    CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
"""

_POSTGRES_SCHEMA = """
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        stripe_customer_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT DEFAULT 'default',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked BOOLEAN DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS usage (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        tokens INT NOT NULL DEFAULT 0,
        cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
        model TEXT,
        pipeline TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_usage_user ON usage(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_date ON usage(created_at);
    CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
"""


def init_db() -> None:
    """Create tables if they don't exist."""
    conn = _get_db()
    if USE_POSTGRES:
        cur = conn.cursor()
        cur.execute(_POSTGRES_SCHEMA)
        conn.commit()
    else:
        conn.executescript(_SQLITE_SCHEMA)
        conn.commit()
    conn.close()


# ── Password hashing ───────────────────────────────────────────────────────

def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    return f"{salt}:{h}"


def _verify_password(password: str, stored: str) -> bool:
    salt, h = stored.split(":", 1)
    return hashlib.sha256(f"{salt}:{password}".encode()).hexdigest() == h


# ── User operations ────────────────────────────────────────────────────────

def create_user(email: str, password: str) -> dict:
    conn = _get_db()
    now = datetime.now(timezone.utc).isoformat()
    pw_hash = _hash_password(password)

    try:
        if USE_POSTGRES:
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                "INSERT INTO users (email, password_hash, plan, created_at) VALUES (%s, %s, 'free', %s) RETURNING id",
                (email, pw_hash, now),
            )
            user_id = cur.fetchone()["id"]
        else:
            conn.execute(
                "INSERT INTO users (email, password_hash, plan, created_at) VALUES (?, ?, 'free', ?)",
                (email, pw_hash, now),
            )
            user_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        api_key = f"mmcp_{secrets.token_hex(24)}"

        _execute(conn,
            "INSERT INTO api_keys (key, user_id, created_at) VALUES (?, ?, ?)",
            (api_key, user_id, now),
        )
        conn.commit()
        conn.close()

        return {"user_id": user_id, "email": email, "api_key": api_key, "plan": "free"}
    except Exception as e:
        conn.close()
        if "unique" in str(e).lower() or "duplicate" in str(e).lower() or "integrity" in str(e).lower():
            raise ValueError(f"Email {email} already registered")
        raise


def authenticate_user(email: str, password: str) -> dict | None:
    conn = _get_db()
    row = _fetchone(conn, "SELECT * FROM users WHERE email = ?", (email,))
    if not row or not _verify_password(password, row["password_hash"]):
        conn.close()
        return None

    key_row = _fetchone(conn,
        "SELECT key FROM api_keys WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 1",
        (row["id"],),
    )
    conn.close()

    return {
        "user_id": row["id"],
        "email": row["email"],
        "plan": row["plan"],
        "api_key": key_row["key"] if key_row else None,
    }


def get_user_by_key(api_key: str) -> dict | None:
    conn = _get_db()
    row = _fetchone(conn,
        """SELECT u.id, u.email, u.plan, k.key
           FROM api_keys k JOIN users u ON k.user_id = u.id
           WHERE k.key = ? AND k.revoked = 0""",
        (api_key,),
    )
    conn.close()
    if not row:
        return None
    return {"user_id": row["id"], "email": row["email"], "plan": row["plan"], "api_key": row["key"]}


def update_user_plan(user_id: int, plan: str, stripe_customer_id: str | None = None) -> None:
    """Update a user's plan (called by Stripe webhook)."""
    conn = _get_db()
    if stripe_customer_id:
        _execute(conn, "UPDATE users SET plan = ?, stripe_customer_id = ? WHERE id = ?",
                 (plan, stripe_customer_id, user_id))
    else:
        _execute(conn, "UPDATE users SET plan = ? WHERE id = ?", (plan, user_id))
    conn.commit()
    conn.close()


def get_user_by_email(email: str) -> dict | None:
    """Get user by email (for Stripe webhook matching)."""
    conn = _get_db()
    row = _fetchone(conn, "SELECT id, email, plan, stripe_customer_id FROM users WHERE email = ?", (email,))
    conn.close()
    return row


# ── Usage tracking ─────────────────────────────────────────────────────────

def log_usage(user_id: int, tokens: int, cost_usd: float, model: str, pipeline: str) -> None:
    conn = _get_db()
    now = datetime.now(timezone.utc).isoformat()
    _execute(conn,
        "INSERT INTO usage (user_id, tokens, cost_usd, model, pipeline, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, tokens, cost_usd, model, pipeline, now),
    )
    conn.commit()
    conn.close()


def get_usage(user_id: int, since: str | None = None) -> dict:
    conn = _get_db()
    if since:
        row = _fetchone(conn,
            "SELECT COUNT(*) as runs, COALESCE(SUM(tokens), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost FROM usage WHERE user_id = ? AND created_at >= ?",
            (user_id, since),
        )
    else:
        row = _fetchone(conn,
            "SELECT COUNT(*) as runs, COALESCE(SUM(tokens), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost FROM usage WHERE user_id = ?",
            (user_id,),
        )
    conn.close()
    return {"runs": row["runs"], "tokens": row["tokens"], "cost_usd": float(row["cost"])}
