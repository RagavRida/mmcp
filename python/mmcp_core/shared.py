"""
MMCP SharedContextStore — mirrors TypeScript src/store/shared.ts exactly.
Append-only key-value store shared across all nodes in a pipeline.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Any


@dataclass
class SharedContextEntry:
    key: str
    value: Any
    author_ctx_id: str
    timestamp: str
    version: int
    metadata: Optional[dict] = None


class SharedContextStore:
    def __init__(self) -> None:
        self._store: dict[str, list[SharedContextEntry]] = {}

    def set(
        self,
        key: str,
        value: Any,
        author_ctx_id: str,
        metadata: dict | None = None,
        observer: Any = None,
    ) -> SharedContextEntry:
        """Append a new entry for key. Returns the entry written."""
        entries = self._store.get(key, [])
        entry = SharedContextEntry(
            key=key,
            value=value,
            author_ctx_id=author_ctx_id,
            timestamp=datetime.now(timezone.utc).isoformat(),
            version=len(entries) + 1,
            metadata=metadata,
        )
        # Append-only — never overwrite
        self._store[key] = [*entries, entry]

        if observer:
            observer.emit("mmcp.shared.write", {
                "key": key,
                "author_ctx_id": author_ctx_id,
                "version": entry.version,
            })

        return entry

    def get(self, key: str) -> list[SharedContextEntry]:
        return self._store.get(key, [])

    def latest(self, key: str) -> Any | None:
        entries = self._store.get(key, [])
        return entries[-1].value if entries else None

    def latest_entry(self, key: str) -> SharedContextEntry | None:
        entries = self._store.get(key, [])
        return entries[-1] if entries else None

    def has(self, key: str) -> bool:
        return key in self._store and bool(self._store[key])

    def keys(self) -> list[str]:
        return list(self._store.keys())

    def snapshot(self) -> dict[str, Any]:
        return {k: v[-1].value for k, v in self._store.items() if v}

    def history(self) -> list[SharedContextEntry]:
        all_entries = [e for entries in self._store.values() for e in entries]
        return sorted(all_entries, key=lambda e: e.timestamp)

    def diff(self, since: str) -> list[SharedContextEntry]:
        return [e for e in self.history() if e.timestamp > since]

    def clear(self, key: str | None = None) -> None:
        if key:
            self._store.pop(key, None)
        else:
            self._store.clear()
