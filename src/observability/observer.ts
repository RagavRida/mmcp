// ─────────────────────────────────────────────────────────────────────────────
// MMCP Observer  |  v2.0  —  Async Event Bus with typed filtering
// ─────────────────────────────────────────────────────────────────────────────

import { MMCPEvent, MMCPEventType, MMCPEventHandler } from "../core/types";

export type TypedEventHandler = (event: MMCPEvent) => void | Promise<void>;

interface EventSubscription {
    type?: MMCPEventType;          // undefined = wildcard (all events)
    handler: TypedEventHandler;
    once: boolean;
}

export class MMCPObserver {
    private subscriptions: EventSubscription[] = [];
    private history: MMCPEvent[] = [];
    private maxHistory: number;

    constructor(maxHistory: number = 500) {
        this.maxHistory = maxHistory;
    }

    // ── Subscribe ───────────────────────────────────────────────────────────

    /** Subscribe to all events. */
    on(handler: MMCPEventHandler): void;
    /** Subscribe to a specific event type. */
    on(type: MMCPEventType, handler: TypedEventHandler): void;
    on(typeOrHandler: MMCPEventType | MMCPEventHandler, handler?: TypedEventHandler): void {
        if (typeof typeOrHandler === "function") {
            this.subscriptions.push({ handler: typeOrHandler, once: false });
        } else {
            this.subscriptions.push({ type: typeOrHandler, handler: handler!, once: false });
        }
    }

    /** Subscribe once — handler fires at most one time, then auto-removes. */
    once(type: MMCPEventType, handler: TypedEventHandler): void {
        this.subscriptions.push({ type, handler, once: true });
    }

    /** Unsubscribe a handler. */
    off(handler: TypedEventHandler): void {
        this.subscriptions = this.subscriptions.filter(s => s.handler !== handler);
    }

    // ── Emit ────────────────────────────────────────────────────────────────

    /** Emit an event. Handlers run concurrently. */
    emit(type: MMCPEventType, data: Record<string, unknown>, context_id?: string): void {
        const event: MMCPEvent = {
            type,
            timestamp: new Date().toISOString(),
            context_id,
            data,
        };

        // Store in history
        this.history.push(event);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        // Fire matching subscriptions
        const toRemove: EventSubscription[] = [];
        for (const sub of this.subscriptions) {
            if (sub.type === undefined || sub.type === type) {
                try {
                    const result = sub.handler(event);
                    // If async, swallow rejections silently (handlers must not throw)
                    if (result && typeof (result as any).catch === "function") {
                        (result as Promise<void>).catch(() => {});
                    }
                } catch {
                    /* handlers must not throw */
                }
                if (sub.once) {
                    toRemove.push(sub);
                }
            }
        }

        // Clean up once-handlers
        if (toRemove.length > 0) {
            this.subscriptions = this.subscriptions.filter(s => !toRemove.includes(s));
        }
    }

    // ── Async Utilities ─────────────────────────────────────────────────────

    /**
     * Returns a Promise that resolves when the next event of the given type fires.
     * Useful for: `const event = await observer.waitFor("mmcp.task.completed");`
     */
    waitFor(type: MMCPEventType, timeoutMs?: number): Promise<MMCPEvent> {
        return new Promise<MMCPEvent>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;

            const handler: TypedEventHandler = (event) => {
                if (timer) clearTimeout(timer);
                resolve(event);
            };

            this.once(type, handler);

            if (timeoutMs !== undefined) {
                timer = setTimeout(() => {
                    this.off(handler);
                    reject(new Error(`waitFor("${type}") timed out after ${timeoutMs}ms`));
                }, timeoutMs);
            }
        });
    }

    // ── History Access ───────────────────────────────────────────────────────

    /** Get the last N events (all types). */
    getHistory(limit?: number): MMCPEvent[] {
        if (limit) {
            return this.history.slice(-limit);
        }
        return [...this.history];
    }

    /** Get the last N events of a specific type. */
    getHistoryByType(type: MMCPEventType, limit?: number): MMCPEvent[] {
        const filtered = this.history.filter(e => e.type === type);
        if (limit) {
            return filtered.slice(-limit);
        }
        return filtered;
    }

    /** Clear event history. */
    clearHistory(): void {
        this.history = [];
    }

    // ── Convenience ─────────────────────────────────────────────────────────

    /** Log all events to console. */
    enableConsoleLogging(prefix = "[MMCP]"): void {
        this.on((event) => {
            const id = event.context_id ? ` ${event.context_id}` : "";
            console.log(`${prefix} ${event.type}${id}`, event.data);
        });
    }
}
