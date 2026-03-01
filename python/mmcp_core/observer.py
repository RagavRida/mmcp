"""
MMCP Observer — mirrors TypeScript src/observability/observer.ts exactly.
"""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Callable
from .types import MMCPEvent, MMCPEventType

MMCPEventHandler = Callable[[MMCPEvent], None]


class MMCPObserver:
    def __init__(self) -> None:
        self._handlers: list[MMCPEventHandler] = []

    def on(self, handler: MMCPEventHandler) -> None:
        self._handlers.append(handler)

    def off(self, handler: MMCPEventHandler) -> None:
        self._handlers = [h for h in self._handlers if h != handler]

    def emit(
        self,
        event_type: MMCPEventType,
        data: dict,
        context_id: str | None = None,
    ) -> None:
        event = MMCPEvent(
            type=event_type,
            timestamp=datetime.now(timezone.utc).isoformat(),
            data=data,
            context_id=context_id,
        )
        for handler in self._handlers:
            try:
                handler(event)
            except Exception:
                pass  # handlers must not throw

    def enable_console_logging(self, prefix: str = "[MMCP]") -> None:
        def log(event: MMCPEvent) -> None:
            ctx_id = f" {event.context_id}" if event.context_id else ""
            print(f"{prefix} {event.type}{ctx_id}", event.data)
        self.on(log)
