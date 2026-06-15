import type {
    AuthKeyMeta,
    AuthKeyRecord,
    AuthKeyRepo,
    SaltRepo,
    SaltScheduleEntry,
    SessionRecord,
    SessionRepo,
    Storage,
} from './types.js'

/**
 * In-memory storage. The default backend so the gateway runs with no external
 * services (dev, tests). Auth keys/sessions do not survive a restart — use the
 * Mongo backend for that.
 */
class MemoryAuthKeyRepo implements AuthKeyRepo {
    private map = new Map<string, AuthKeyRecord>()

    async create(rec: AuthKeyRecord): Promise<void> {
        this.map.set(rec.id.toString(), { ...rec })
    }
    async getById(id: bigint): Promise<AuthKeyRecord | null> {
        return this.map.get(id.toString()) ?? null
    }
    async setBlocked(id: bigint, blocked: boolean): Promise<void> {
        const rec = this.map.get(id.toString())
        if (rec) rec.isBlocked = blocked
    }
    async bindUser(id: bigint, subject: string | null): Promise<void> {
        const rec = this.map.get(id.toString())
        if (rec) rec.subject = subject
    }
    async updateMeta(id: bigint, patch: AuthKeyMeta): Promise<void> {
        const rec = this.map.get(id.toString())
        if (!rec) return
        const meta = (rec.meta ??= {})
        for (const [k, v] of Object.entries(patch)) {
            if (v !== undefined) (meta as Record<string, unknown>)[k] = v
        }
    }
}

class MemorySaltRepo implements SaltRepo {
    private map = new Map<string, SaltScheduleEntry[]>()
    async append(authKeyId: bigint, entries: SaltScheduleEntry[]): Promise<void> {
        const k = authKeyId.toString()
        const list = this.map.get(k) ?? []
        for (const e of entries) {
            // Insert-if-absent by window start; never overwrite an existing salt.
            if (!list.some(x => x.validSince === e.validSince)) list.push({ ...e })
        }
        list.sort((a, b) => a.validSince - b.validSince)
        this.map.set(k, list)
    }
    async list(authKeyId: bigint): Promise<SaltScheduleEntry[]> {
        return (this.map.get(authKeyId.toString()) ?? []).map(e => ({ ...e }))
    }
    async prune(authKeyId: bigint, before: number): Promise<void> {
        const k = authKeyId.toString()
        const list = this.map.get(k)
        if (list)
            this.map.set(
                k,
                list.filter(e => e.validUntil > before),
            )
    }
}

class MemorySessionRepo implements SessionRepo {
    private map = new Map<string, SessionRecord>()
    async get(sessionId: bigint): Promise<SessionRecord | null> {
        const r = this.map.get(sessionId.toString())
        return r ? { ...r } : null
    }
    async save(rec: SessionRecord): Promise<void> {
        this.map.set(rec.sessionId.toString(), { ...rec })
    }
    async update(sessionId: bigint, patch: Partial<SessionRecord>): Promise<void> {
        const r = this.map.get(sessionId.toString())
        if (r) this.map.set(sessionId.toString(), { ...r, ...patch })
    }
    async delete(sessionId: bigint): Promise<void> {
        this.map.delete(sessionId.toString())
    }
    async touch(sessionId: bigint): Promise<boolean> {
        const r = this.map.get(sessionId.toString())
        if (!r) return false
        r.lastActivity = Date.now()
        return true
    }
}

export function createMemoryStorage(): Storage {
    return {
        authKeys: new MemoryAuthKeyRepo(),
        salts: new MemorySaltRepo(),
        sessions: new MemorySessionRepo(),
        async close() {},
    }
}
