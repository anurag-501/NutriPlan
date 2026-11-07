"""SQLite persistence for reusable API projects, clients, usage, and opt-in chat."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent


def database_path() -> Path:
    configured = os.getenv("NUTRIPLAN_DB_PATH", "").strip()
    path = Path(configured) if configured else BACKEND_DIR / "data" / "api_platform.sqlite3"
    if not path.is_absolute():
        path = PROJECT_ROOT / path
    return path.resolve()


@contextmanager
def connect():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def _now() -> str:
    return datetime.now(UTC).isoformat()


def initialize_database() -> None:
    """Create tables if needed and seed only the non-secret local NutriPlan project."""
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                project_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                system_prompt TEXT NOT NULL DEFAULT '',
                enabled_modules TEXT NOT NULL DEFAULT '["chat","nutrition","recipes"]',
                rate_limit_per_minute INTEGER NOT NULL DEFAULT 30,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS api_clients (
                client_id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                key_prefix TEXT NOT NULL UNIQUE,
                key_salt BLOB NOT NULL,
                key_hash BLOB NOT NULL,
                created_at TEXT NOT NULL,
                revoked_at TEXT
            );
            CREATE INDEX IF NOT EXISTS api_clients_project_idx ON api_clients(project_id);
            CREATE TABLE IF NOT EXISTS conversations (
                conversation_id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                client_id TEXT NOT NULL REFERENCES api_clients(client_id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS conversations_owner_idx ON conversations(project_id, client_id);
            CREATE TABLE IF NOT EXISTS messages (
                message_id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('user','assistant')),
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, message_id);
            CREATE TABLE IF NOT EXISTS usage_records (
                usage_id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
                client_id TEXT NOT NULL REFERENCES api_clients(client_id) ON DELETE CASCADE,
                route TEXT NOT NULL,
                status_code INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS usage_project_idx ON usage_records(project_id, created_at);
            """
        )
        db.execute(
            "INSERT OR IGNORE INTO projects(project_id,name,description,created_at) VALUES(?,?,?,?)",
            ("nutriplan", "NutriPlan", "Nutrition and recipe recommendation services", _now()),
        )


def _project_row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    result = dict(row)
    result["enabled_modules"] = json.loads(result["enabled_modules"])
    return result


def get_project(project_id: str) -> dict[str, Any] | None:
    with connect() as db:
        return _project_row(db.execute("SELECT * FROM projects WHERE project_id=?", (project_id,)).fetchone())


def create_project(project_id: str, name: str, description: str, system_prompt: str, enabled_modules: list[str], rate_limit: int) -> dict[str, Any]:
    with connect() as db:
        db.execute(
            "INSERT INTO projects(project_id,name,description,system_prompt,enabled_modules,rate_limit_per_minute,created_at) VALUES(?,?,?,?,?,?,?)",
            (project_id, name, description, system_prompt, json.dumps(enabled_modules), rate_limit, _now()),
        )
    project = get_project(project_id)
    assert project is not None
    return project


def create_client(project_id: str, name: str) -> tuple[dict[str, Any], str]:
    client_id = str(uuid.uuid4())
    key = "npk_" + secrets.token_urlsafe(36)
    prefix = key[:20]
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", key.encode(), salt, 310_000)
    created = _now()
    with connect() as db:
        db.execute(
            "INSERT INTO api_clients(client_id,project_id,name,key_prefix,key_salt,key_hash,created_at) VALUES(?,?,?,?,?,?,?)",
            (client_id, project_id, name, prefix, salt, digest, created),
        )
    return {"client_id": client_id, "project_id": project_id, "name": name, "created_at": created}, key


def authenticate_client(api_key: str) -> dict[str, Any] | None:
    if not api_key.startswith("npk_") or len(api_key) < 32:
        return None
    with connect() as db:
        row = db.execute(
            "SELECT c.client_id,c.project_id,c.name,c.key_salt,c.key_hash,p.name AS project_name "
            "FROM api_clients c JOIN projects p ON p.project_id=c.project_id "
            "WHERE c.key_prefix=? AND c.revoked_at IS NULL",
            (api_key[:20],),
        ).fetchone()
    if row is None:
        return None
    candidate = hashlib.pbkdf2_hmac("sha256", api_key.encode(), row["key_salt"], 310_000)
    if not hmac.compare_digest(candidate, row["key_hash"]):
        return None
    result = dict(row)
    result.pop("key_salt", None)
    result.pop("key_hash", None)
    return result


def list_project_clients(project_id: str) -> list[dict[str, Any]]:
    with connect() as db:
        rows = db.execute(
            "SELECT client_id,project_id,name,key_prefix,created_at,revoked_at FROM api_clients WHERE project_id=? ORDER BY created_at",
            (project_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def revoke_client(project_id: str, client_id: str) -> bool:
    with connect() as db:
        cursor = db.execute(
            "UPDATE api_clients SET revoked_at=? WHERE project_id=? AND client_id=? AND revoked_at IS NULL",
            (_now(), project_id, client_id),
        )
    return cursor.rowcount > 0


def owns_conversation(project_id: str, client_id: str, conversation_id: str) -> bool:
    with connect() as db:
        row = db.execute(
            "SELECT 1 FROM conversations WHERE conversation_id=? AND project_id=? AND client_id=?",
            (conversation_id, project_id, client_id),
        ).fetchone()
    return row is not None


def save_conversation_turns(project_id: str, client_id: str, conversation_id: str, turns: list[tuple[str, str]]) -> None:
    now = _now()
    with connect() as db:
        db.execute(
            "INSERT OR IGNORE INTO conversations(conversation_id,project_id,client_id,created_at,updated_at) VALUES(?,?,?,?,?)",
            (conversation_id, project_id, client_id, now, now),
        )
        db.executemany(
            "INSERT INTO messages(conversation_id,role,content,created_at) VALUES(?,?,?,?)",
            [(conversation_id, role, content, now) for role, content in turns],
        )
        db.execute("UPDATE conversations SET updated_at=? WHERE conversation_id=?", (now, conversation_id))


def read_conversation(project_id: str, client_id: str, conversation_id: str) -> list[dict[str, str]] | None:
    with connect() as db:
        owner = db.execute(
            "SELECT 1 FROM conversations WHERE conversation_id=? AND project_id=? AND client_id=?",
            (conversation_id, project_id, client_id),
        ).fetchone()
        if owner is None:
            return None
        rows = db.execute(
            "SELECT role,content,created_at FROM messages WHERE conversation_id=? ORDER BY message_id",
            (conversation_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def delete_conversation(project_id: str, client_id: str, conversation_id: str) -> bool:
    with connect() as db:
        cursor = db.execute(
            "DELETE FROM conversations WHERE conversation_id=? AND project_id=? AND client_id=?",
            (conversation_id, project_id, client_id),
        )
    return cursor.rowcount > 0


def record_usage(project_id: str, client_id: str, route: str, status_code: int, duration_ms: int) -> None:
    with connect() as db:
        db.execute(
            "INSERT INTO usage_records(project_id,client_id,route,status_code,duration_ms,created_at) VALUES(?,?,?,?,?,?)",
            (project_id, client_id, route[:160], status_code, max(0, duration_ms), _now()),
        )


def usage_summary(project_id: str, client_id: str) -> dict[str, Any]:
    with connect() as db:
        row = db.execute(
            "SELECT COUNT(*) AS total_requests, "
            "SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END) AS successful_requests, "
            "SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS failed_requests, "
            "AVG(duration_ms) AS average_response_ms "
            "FROM usage_records WHERE project_id=? AND client_id=?",
            (project_id, client_id),
        ).fetchone()
    return {
        "total_requests": row["total_requests"] or 0,
        "successful_requests": row["successful_requests"] or 0,
        "failed_requests": row["failed_requests"] or 0,
        "average_response_ms": round(row["average_response_ms"] or 0, 1),
    }
