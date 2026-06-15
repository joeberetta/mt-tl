import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'

/**
 * A persisted user with the TWO ids this app keeps deliberately separate:
 *
 *   - `_id`     — the **public** TL `user.id` (`int`). This is what clients see
 *                 and send back in `inputUser.user_id`; it's Telegram-style
 *                 baggage and stays an int for wire-compat.
 *   - `subject` — the **internal** id (a uuid `string`). This is what the MTProto
 *                 gateway binds to the auth key (`ctx.login(subject)`), routes
 *                 presence/push by, and what you pass between your microservices.
 *                 Never goes on the TL wire.
 *
 * This row is the single place the two are linked: given a public `_id` you can
 * find the `subject` (and vice-versa), so handlers translate at the edge and the
 * rest of the system speaks only one id.
 */
export interface StoredUser {
    _id: number
    subject: string
    publicKey: string
    eosName: string
    firstName: string
    lastName: string
    username: string
    email: string
    phone: string
    country?: string
    createdAt: Date
}

export type NewUser = Omit<StoredUser, '_id' | 'subject' | 'createdAt'>

/** User persistence the auth flow needs. Swappable: in-memory or Mongo. */
export interface UserRepo {
    /** Look up by the public TL id (`int`) — e.g. an inbound `inputUser.user_id`. */
    getById(id: number): Promise<StoredUser | null>
    /** Look up by the internal subject (uuid) — e.g. the gateway-bound `ctx.subject`. */
    getBySubject(subject: string): Promise<StoredUser | null>
    findByPublicKey(publicKey: string): Promise<StoredUser | null>
    findByUsername(username: string): Promise<StoredUser | null>
    findByEmail(email: string): Promise<StoredUser | null>
    create(user: NewUser): Promise<StoredUser>
}

/** In-memory repo for tests and dev (no Mongo). Ids start above 100. */
export class InMemoryUserRepo implements UserRepo {
    private readonly byId = new Map<number, StoredUser>()
    private readonly bySubject = new Map<string, StoredUser>()
    private seq = 1000

    async getById(id: number): Promise<StoredUser | null> {
        return this.byId.get(id) ?? null
    }
    async getBySubject(subject: string): Promise<StoredUser | null> {
        return this.bySubject.get(subject) ?? null
    }
    async findByPublicKey(publicKey: string): Promise<StoredUser | null> {
        return [...this.byId.values()].find(u => u.publicKey === publicKey) ?? null
    }
    async findByUsername(username: string): Promise<StoredUser | null> {
        if (!username) return null
        const lc = username.toLowerCase()
        return [...this.byId.values()].find(u => u.username.toLowerCase() === lc) ?? null
    }
    async findByEmail(email: string): Promise<StoredUser | null> {
        if (!email) return null
        const lc = email.toLowerCase()
        return [...this.byId.values()].find(u => u.email.toLowerCase() === lc) ?? null
    }
    async create(user: NewUser): Promise<StoredUser> {
        // Mint both ids at once: a public int (`_id`) and an internal uuid (`subject`).
        const stored: StoredUser = { ...user, _id: ++this.seq, subject: randomUUID(), createdAt: new Date() }
        this.byId.set(stored._id, stored)
        this.bySubject.set(stored.subject, stored)
        return stored
    }
}

/**
 * Mongo-backed repo. `_id` is a monotonic int from a `counters` document so
 * user ids are small/stable (TL `user.id` is an int). Index the lookup fields.
 */
export class MongoUserRepo implements UserRepo {
    constructor(
        private readonly db: Db,
        private readonly collection = 'users',
        private readonly counters = 'counters',
    ) {}

    private get users() {
        return this.db.collection<StoredUser>(this.collection)
    }

    /** Ensures the indexes the auth lookups rely on. Call once at startup. */
    async ensureIndexes(): Promise<void> {
        await this.users.createIndex({ publicKey: 1 }, { unique: true })
        await this.users.createIndex({ subject: 1 }, { unique: true })
        await this.users.createIndex({ username: 1 })
        await this.users.createIndex({ email: 1 })
    }

    private async nextId(): Promise<number> {
        const res = await this.db
            .collection<{ _id: string; seq: number }>(this.counters)
            .findOneAndUpdate(
                { _id: 'users' },
                { $inc: { seq: 1 } },
                { upsert: true, returnDocument: 'after' },
            )
        // Start ids above 100 (TL reserves low ids for service users).
        return 1000 + (res?.seq ?? 1)
    }

    async getById(id: number): Promise<StoredUser | null> {
        return this.users.findOne({ _id: id })
    }
    async getBySubject(subject: string): Promise<StoredUser | null> {
        return this.users.findOne({ subject })
    }
    async findByPublicKey(publicKey: string): Promise<StoredUser | null> {
        return this.users.findOne({ publicKey })
    }
    async findByUsername(username: string): Promise<StoredUser | null> {
        if (!username) return null
        return this.users.findOne({ username })
    }
    async findByEmail(email: string): Promise<StoredUser | null> {
        if (!email) return null
        return this.users.findOne({ email })
    }
    async create(user: NewUser): Promise<StoredUser> {
        // Public int id from the counter; internal uuid subject minted alongside.
        const stored: StoredUser = {
            ...user,
            _id: await this.nextId(),
            subject: randomUUID(),
            createdAt: new Date(),
        }
        await this.users.insertOne(stored)
        return stored
    }
}
