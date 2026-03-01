// ─────────────────────────────────────────────────────────────────────────────
// SharedContextStore  |  MMCP v0.1
// Append-only key-value store shared across all nodes in a pipeline.
// Every write is immutable — reads return full history or latest value.
// ─────────────────────────────────────────────────────────────────────────────

import { MMCPObserver } from "../observability/observer";

export interface SharedContextEntry {
    key: string;
    value: unknown;
    author_ctx_id: string;
    timestamp: string;            // ISO 8601
    version: number;            // auto-increment per key, starting at 1
    metadata?: Record<string, unknown>;
}

export class SharedContextStore {
    private store = new Map<string, SharedContextEntry[]>();

    // ── Writes ─────────────────────────────────────────────────────────────────

    /** Append a new entry for key. Returns the entry written. */
    set(
        key: string,
        value: unknown,
        author_ctx_id: string,
        metadata?: Record<string, unknown>,
        observer?: MMCPObserver
    ): SharedContextEntry {
        const entries = this.store.get(key) ?? [];
        const entry: SharedContextEntry = {
            key,
            value,
            author_ctx_id,
            timestamp: new Date().toISOString(),
            version: entries.length + 1,
            metadata,
        };
        this.store.set(key, [...entries, entry]);

        // Emit write event if observer provided
        observer?.emit("mmcp.shared.write", {
            key,
            author_ctx_id,
            version: entry.version,
        });

        return entry;
    }

    // ── Reads ──────────────────────────────────────────────────────────────────

    /** Full write history for a key (oldest first). */
    get(key: string): SharedContextEntry[] {
        return this.store.get(key) ?? [];
    }

    /** Most recent value for a key, or null if not set. */
    latest(key: string): unknown | null {
        const entries = this.store.get(key);
        if (!entries || entries.length === 0) return null;
        return entries[entries.length - 1].value;
    }

    /** Most recent entry for a key, or null if not set. */
    latestEntry(key: string): SharedContextEntry | null {
        const entries = this.store.get(key);
        if (!entries || entries.length === 0) return null;
        return entries[entries.length - 1];
    }

    /** True if the key has at least one entry. */
    has(key: string): boolean {
        return this.store.has(key) && (this.store.get(key)?.length ?? 0) > 0;
    }

    /** All keys that have been written. */
    keys(): string[] {
        return Array.from(this.store.keys());
    }

    // ── Aggregates ─────────────────────────────────────────────────────────────

    /** Flat object of { key → latest value } for all keys. */
    snapshot(): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [key, entries] of this.store) {
            if (entries.length > 0) {
                out[key] = entries[entries.length - 1].value;
            }
        }
        return out;
    }

    /** Every entry across all keys, sorted by timestamp ascending. */
    history(): SharedContextEntry[] {
        const all: SharedContextEntry[] = [];
        for (const entries of this.store.values()) {
            all.push(...entries);
        }
        return all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }

    /** All entries written after `since` (exclusive), sorted by timestamp. */
    diff(since: string): SharedContextEntry[] {
        return this.history().filter(e => e.timestamp > since);
    }

    // ── Mutation (testing only) ────────────────────────────────────────────────

    /** Clear entries for one key, or all keys if no argument. */
    clear(key?: string): void {
        if (key !== undefined) {
            this.store.delete(key);
        } else {
            this.store.clear();
        }
    }
}
