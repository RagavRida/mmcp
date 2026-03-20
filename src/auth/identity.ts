// ─────────────────────────────────────────────────────────────────────────────
// MMCP Identity & Auth Layer  |  v2.1
// API key management, agent authentication, and permission-based access control.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from "uuid";

// ── Types ────────────────────────────────────────────────────────────────────

export type Permission =
    | "execute"          // can execute pipelines
    | "read"            // can read results
    | "write"           // can create tasks
    | "admin"           // full access
    | "verify"          // can verify outputs
    | "route"           // can configure routing
    | "agent:register"  // can register external agents
    | "agent:execute";  // can call external agents

export interface APIKey {
    key_id: string;
    key_hash: string;                  // hashed version of the API key
    owner: string;                     // owner identifier (user, team, or service)
    permissions: Permission[];
    created_at: string;
    expires_at?: string;
    last_used_at?: string;
    rate_limit_rpm?: number;           // requests per minute
    metadata: Record<string, unknown>;
    revoked: boolean;
}

export interface AuthResult {
    authenticated: boolean;
    key_id?: string;
    owner?: string;
    permissions: Permission[];
    error?: string;
}

// ── Simple Hash (for demo — use bcrypt/argon2 in production) ─────────────────

function simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return `h_${Math.abs(hash).toString(36)}`;
}

// ── Identity Manager ─────────────────────────────────────────────────────────

export class IdentityManager {
    private keys = new Map<string, APIKey>();          // key_hash → APIKey
    private keyIdIndex = new Map<string, string>();    // key_id → key_hash

    /** Generate a new API key with specified permissions. Returns the raw key (show once). */
    createKey(
        owner: string,
        permissions: Permission[],
        options: {
            expires_at?: string;
            rate_limit_rpm?: number;
            metadata?: Record<string, unknown>;
        } = {}
    ): { api_key: string; key_id: string } {
        const rawKey = `mmcp_${uuidv4().replace(/-/g, "")}`;
        const keyHash = simpleHash(rawKey);
        const keyId = `key_${uuidv4().replace(/-/g, "").slice(0, 12)}`;

        const apiKey: APIKey = {
            key_id: keyId,
            key_hash: keyHash,
            owner,
            permissions,
            created_at: new Date().toISOString(),
            expires_at: options.expires_at,
            rate_limit_rpm: options.rate_limit_rpm,
            metadata: options.metadata ?? {},
            revoked: false,
        };

        this.keys.set(keyHash, apiKey);
        this.keyIdIndex.set(keyId, keyHash);

        return { api_key: rawKey, key_id: keyId };
    }

    /** Authenticate a raw API key. Returns permissions if valid. */
    authenticate(rawKey: string): AuthResult {
        const hash = simpleHash(rawKey);
        const apiKey = this.keys.get(hash);

        if (!apiKey) {
            return { authenticated: false, permissions: [], error: "Invalid API key" };
        }

        if (apiKey.revoked) {
            return { authenticated: false, permissions: [], error: "API key has been revoked" };
        }

        if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
            return { authenticated: false, permissions: [], error: "API key has expired" };
        }

        // Update last used timestamp
        apiKey.last_used_at = new Date().toISOString();

        return {
            authenticated: true,
            key_id: apiKey.key_id,
            owner: apiKey.owner,
            permissions: apiKey.permissions,
        };
    }

    /** Check if an authenticated key has a specific permission. */
    authorize(authResult: AuthResult, required: Permission): boolean {
        if (!authResult.authenticated) return false;
        if (authResult.permissions.includes("admin")) return true;
        return authResult.permissions.includes(required);
    }

    /** Check multiple permissions (all must be present). */
    authorizeAll(authResult: AuthResult, required: Permission[]): boolean {
        return required.every(p => this.authorize(authResult, p));
    }

    /** Revoke an API key by key_id. */
    revokeKey(key_id: string): boolean {
        const hash = this.keyIdIndex.get(key_id);
        if (!hash) return false;

        const apiKey = this.keys.get(hash);
        if (!apiKey) return false;

        apiKey.revoked = true;
        return true;
    }

    /** List all keys for an owner (excludes hash for security). */
    listKeys(owner: string): Array<Omit<APIKey, "key_hash">> {
        const results: Array<Omit<APIKey, "key_hash">> = [];
        for (const apiKey of this.keys.values()) {
            if (apiKey.owner === owner) {
                const { key_hash: _, ...safe } = apiKey;
                results.push(safe);
            }
        }
        return results;
    }

    /** Get key info by ID (excludes hash). */
    getKey(key_id: string): Omit<APIKey, "key_hash"> | null {
        const hash = this.keyIdIndex.get(key_id);
        if (!hash) return null;
        const apiKey = this.keys.get(hash);
        if (!apiKey) return null;
        const { key_hash: _, ...safe } = apiKey;
        return safe;
    }

    /** Total number of registered keys. */
    get size(): number {
        return this.keys.size;
    }

    /** Clear all keys. */
    clear(): void {
        this.keys.clear();
        this.keyIdIndex.clear();
    }
}
