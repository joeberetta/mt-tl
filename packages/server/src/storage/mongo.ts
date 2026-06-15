import { MongoClient, Binary, type Db, type Collection, type AnyBulkWriteOperation } from 'mongodb'
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
 * MongoDB-backed storage. Uses the gateway's own collections (auth keys are not
 * shared byte-for-byte with the legacy server's encoding — that's a migration
 * concern, out of Phase-1 scope). bigints are stored as decimal strings.
 */

interface AuthKeyDoc {
    _id: string
    key: Binary
    expiresIn: boolean
    createdAt: Date
    subject: string | null
    isBlocked?: boolean
    meta?: AuthKeyRecord['meta']
}
interface SaltDoc {
    /** `${authKeyId}:${validSince}` — one document per scheduled window. */
    _id: string
    authKeyId: string
    salt: string
    validSince: number
    validUntil: number
}
interface SessionDoc {
    _id: string
    authKeyId: string
    uniqueId: string
    apiLayer: number
    subject?: string
    lastActivity: number
}

function toBuf(b: Binary): Buffer {
    return Buffer.from(b.buffer)
}

class MongoAuthKeyRepo implements AuthKeyRepo {
    constructor(private readonly col: Collection<AuthKeyDoc>) {}
    async create(rec: AuthKeyRecord): Promise<void> {
        await this.col.updateOne(
            { _id: rec.id.toString() },
            {
                $set: {
                    key: new Binary(rec.key),
                    expiresIn: rec.expiresIn,
                    createdAt: rec.createdAt,
                    subject: rec.subject,
                    isBlocked: rec.isBlocked ?? false,
                    meta: rec.meta,
                },
            },
            { upsert: true },
        )
    }
    async getById(id: bigint): Promise<AuthKeyRecord | null> {
        const doc = await this.col.findOne({ _id: id.toString() })
        if (!doc) return null
        return {
            id,
            key: toBuf(doc.key),
            expiresIn: doc.expiresIn,
            createdAt: doc.createdAt,
            subject: doc.subject,
            isBlocked: doc.isBlocked,
            meta: doc.meta,
        }
    }
    async setBlocked(id: bigint, blocked: boolean): Promise<void> {
        await this.col.updateOne({ _id: id.toString() }, { $set: { isBlocked: blocked } })
    }
    async bindUser(id: bigint, subject: string | null): Promise<void> {
        await this.col.updateOne({ _id: id.toString() }, { $set: { subject } })
    }
    async updateMeta(id: bigint, patch: AuthKeyMeta): Promise<void> {
        // Set defined fields under dotted `meta.*` paths so we never clobber the
        // sibling fields (e.g. `meta.apiLayer` set at handshake time).
        const set: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(patch)) {
            if (v !== undefined) set[`meta.${k}`] = v
        }
        if (Object.keys(set).length) await this.col.updateOne({ _id: id.toString() }, { $set: set })
    }
}

class MongoSaltRepo implements SaltRepo {
    constructor(private readonly col: Collection<SaltDoc>) {}
    async append(authKeyId: bigint, entries: SaltScheduleEntry[]): Promise<void> {
        if (!entries.length) return
        const key = authKeyId.toString()
        // $setOnInsert keeps the first writer's salt for a window, so all nodes
        // that derive the same (deterministic) window converge on one salt.
        const ops: AnyBulkWriteOperation<SaltDoc>[] = entries.map(e => ({
            updateOne: {
                filter: { _id: `${key}:${e.validSince}` },
                update: {
                    $setOnInsert: {
                        authKeyId: key,
                        salt: e.salt.toString(),
                        validSince: e.validSince,
                        validUntil: e.validUntil,
                    },
                },
                upsert: true,
            },
        }))
        await this.col.bulkWrite(ops, { ordered: false })
    }
    async list(authKeyId: bigint): Promise<SaltScheduleEntry[]> {
        const docs = await this.col
            .find({ authKeyId: authKeyId.toString() })
            .sort({ validSince: 1 })
            .toArray()
        return docs.map(d => ({ salt: BigInt(d.salt), validSince: d.validSince, validUntil: d.validUntil }))
    }
    async prune(authKeyId: bigint, before: number): Promise<void> {
        await this.col.deleteMany({ authKeyId: authKeyId.toString(), validUntil: { $lte: before } })
    }
}

class MongoSessionRepo implements SessionRepo {
    constructor(private readonly col: Collection<SessionDoc>) {}
    async get(sessionId: bigint): Promise<SessionRecord | null> {
        const doc = await this.col.findOne({ _id: sessionId.toString() })
        if (!doc) return null
        return {
            sessionId,
            authKeyId: BigInt(doc.authKeyId),
            uniqueId: BigInt(doc.uniqueId),
            apiLayer: doc.apiLayer,
            subject: doc.subject,
            lastActivity: doc.lastActivity,
        }
    }
    async save(rec: SessionRecord): Promise<void> {
        await this.col.updateOne(
            { _id: rec.sessionId.toString() },
            {
                $set: {
                    authKeyId: rec.authKeyId.toString(),
                    uniqueId: rec.uniqueId.toString(),
                    apiLayer: rec.apiLayer,
                    subject: rec.subject,
                    lastActivity: rec.lastActivity,
                },
            },
            { upsert: true },
        )
    }
    async update(sessionId: bigint, patch: Partial<SessionRecord>): Promise<void> {
        const set: Record<string, unknown> = {}
        if (patch.apiLayer !== undefined) set.apiLayer = patch.apiLayer
        if (patch.subject !== undefined) set.subject = patch.subject
        if (patch.lastActivity !== undefined) set.lastActivity = patch.lastActivity
        if (Object.keys(set).length) await this.col.updateOne({ _id: sessionId.toString() }, { $set: set })
    }
    async delete(sessionId: bigint): Promise<void> {
        await this.col.deleteOne({ _id: sessionId.toString() })
    }
    async touch(sessionId: bigint): Promise<boolean> {
        const res = await this.col.updateOne(
            { _id: sessionId.toString() },
            { $set: { lastActivity: Date.now() } },
        )
        return res.matchedCount > 0
    }
}

export async function createMongoStorage(url: string, dbName: string): Promise<Storage> {
    const client = new MongoClient(url)
    await client.connect()
    const db: Db = client.db(dbName)
    await ensureIndexes(db)
    return {
        authKeys: new MongoAuthKeyRepo(db.collection<AuthKeyDoc>('authKeys')),
        salts: new MongoSaltRepo(db.collection<SaltDoc>('serverSalts')),
        sessions: new MongoSessionRepo(db.collection<SessionDoc>('sessions')),
        async close() {
            await client.close()
        },
    }
}

/**
 * Create the secondary indexes the protocol collections rely on. Idempotent
 * (Mongo no-ops an index that already exists), so it's safe to run on every
 * startup. `_id`-keyed lookups (get/save/touch by id) need no extra index.
 */
async function ensureIndexes(db: Db): Promise<void> {
    await Promise.all([
        // serverSalts: list() filters by authKeyId + sorts by validSince; prune()
        // filters by authKeyId + validUntil.
        db.collection('serverSalts').createIndex({ authKeyId: 1, validSince: 1 }),
        db.collection('serverSalts').createIndex({ authKeyId: 1, validUntil: 1 }),
        // sessions: looked up / aggregated by the key, the user, and recency.
        db.collection('sessions').createIndex({ authKeyId: 1 }),
        db.collection('sessions').createIndex({ subject: 1 }),
        db.collection('sessions').createIndex({ lastActivity: 1 }),
        // authKeys: "all devices for a user", moderation, and creation-over-time.
        db.collection('authKeys').createIndex({ subject: 1 }),
        db.collection('authKeys').createIndex({ isBlocked: 1 }),
        db.collection('authKeys').createIndex({ createdAt: 1 }),
    ])
}
