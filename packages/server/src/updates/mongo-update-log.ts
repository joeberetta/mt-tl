import type { JsonValue } from '@mt-tl/tl'
import type { UpdateLog } from '../core/updates.js'

/**
 * Durable {@link UpdateLog} on MongoDB, for protocol-managed updates
 * (`config.updates.managed`). `pts` is assigned atomically per subject via a
 * counters document (`$inc`), so concurrent replicas never collide; each update
 * is stored with its pts for `updates.getDifference`. Opens its own connection
 * (the updates box is logically separate from auth/salt/session storage).
 */
export async function createMongoUpdateLog(
    mongoUrl: string,
    dbName: string,
): Promise<{ log: UpdateLog; close: () => Promise<void> }> {
    const { MongoClient } = await import('mongodb')
    const client = new MongoClient(mongoUrl)
    await client.connect()
    const db = client.db(dbName)
    const counters = db.collection<{ _id: string; pts: number }>('update_counters')
    const log = db.collection<{ subject: string; pts: number; update: JsonValue }>('updates')
    await log.createIndex({ subject: 1, pts: 1 })

    return {
        log: {
            async append(subject, update) {
                const doc = await counters.findOneAndUpdate(
                    { _id: subject },
                    { $inc: { pts: 1 } },
                    { upsert: true, returnDocument: 'after' },
                )
                const pts = doc?.pts ?? 1
                await log.insertOne({ subject, pts, update })
                return { pts }
            },
            async since(subject, sincePts) {
                const docs = await log
                    .find({ subject, pts: { $gt: sincePts } })
                    .sort({ pts: 1 })
                    .toArray()
                return docs.map(d => ({ pts: d.pts, update: d.update }))
            },
            async currentPts(subject) {
                const doc = await counters.findOne({ _id: subject })
                return doc?.pts ?? 0
            },
        },
        close: () => client.close(),
    }
}
