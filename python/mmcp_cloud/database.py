"""
MMCP Cloud — Database layer (SQLite).

Tables:
  users     — email, hashed password, plan, created_at
  api_keys  — key, user_id, created_at, revoked
  usage     — user_id, tokens, cost, model, timestamp
"""
from __future__ import annotations
import hashlib
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


DB_PATH = os.environ.get("MMCP_DB_PATH", str(Path.home() / ".mmcp" / "cloud.db"))


def _get_db() -> sqlite3.Connection:
    """Get or create a SQLite connection."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    """Create tables if they don't exist."""
    conn = _get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            plan TEXT NOT NULL DEFAULT 'free',
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
    """)
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
        conn.execute(
            "INSERT INTO users (email, password_hash, plan, created_at) VALUES (?, ?, 'free', ?)",
            (email, pw_hash, now),
        )
        conn.commit()
        user_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        # Auto-generate an API key
        api_key = f"mmcp_{secrets.token_hex(24)}"
        conn.execute(
            "INSERT INTO api_keys (key, user_id, created_at) VALUES (?, ?, ?)",
            (api_key, user_id, now),
        )
        conn.commit()
        conn.close()

        return {"user_id": user_id, "email": email, "api_key": api_key, "plan": "free"}
    except sqlite3.IntegrityError:
        conn.close()
        raise ValueError(f"Email {email} already registered")


def authenticate_user(email: str, password: str) -> dict | None:
    conn = _get_db()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not _verify_password(password, row["password_hash"]):
        conn.close()
        return None

    # Get active API key
    key_row = conn.execute(
        "SELECT key FROM api_keys WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC LIMIT 1",
        (row["id"],),
    ).fetchone()
    conn.close()

    return {
        "user_id": row["id"],
        "email": row["email"],
        "plan": row["plan"],
        "api_key": key_row["key"] if key_row else None,
    }


def get_user_by_key(api_key: str) -> dict | None:
    conn = _get_db()
    row = conn.execute(
        """SELECT u.id, u.email, u.plan, k.key
           FROM api_keys k JOIN users u ON k.user_id = u.id
           WHERE k.key = ? AND k.revoked = 0""",
        (api_key,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {"user_id": row["id"], "email": row["email"], "plan": row["plan"], "api_key": row["key"]}


# ── Usage tracking ─────────────────────────────────────────────────────────

def log_usage(user_id: int, tokens: int, cost_usd: float, model: str, pipeline: str) -> None:
    conn = _get_db()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO usage (user_id, tokens, cost_usd, model, pipeline, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, tokens, cost_usd, model, pipeline, now),
    )
    conn.commit()
    conn.close()


def get_usage(user_id: int, since: str | None = None) -> dict:
    conn = _get_db()
    if since:
        rows = conn.execute(
            "SELECT COUNT(*) as runs, COALESCE(SUM(tokens), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost FROM usage WHERE user_id = ? AND created_at >= ?",
            (user_id, since),
        ).fetchone()
    else:
        rows = conn.execute(
            "SELECT COUNT(*) as runs, COALESCE(SUM(tokens), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost FROM usage WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    conn.close()
    return {"runs": rows["runs"], "tokens": rows["tokens"], "cost_usd": rows["cost"]}
