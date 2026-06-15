import type { JsonValue } from '@mt-tl/tl'

/** Publishes a routed live update onto the update bus (in-memory, or Redis pub/sub in prod). */
export type UpdatePublish = (msg: {
    subject?: string
    authKeyId?: string
    update: JsonValue
}) => Promise<void>

/**
 * Emits a server update. `emit(subject, …)` targets a bound `subject` (the common
 * path behind `ctx.push`); `emitToAuthKey` targets a specific (possibly anonymous)
 * connection by auth key. Delivery is **live and best-effort** — the framework
 * keeps no durable update state, so a client that was offline simply misses the
 * push. If you need catch-up (a `getState`/`getDifference` equivalent), own that
 * in your app: persist the updates you care about and implement those methods,
 * since only your app knows which entities (messages, chats, users, …) a client
 * must resync.
 */
export interface UpdateEmitter {
    emit(subject: string, update: JsonValue): Promise<void>
    emitToAuthKey(authKeyId: string, update: JsonValue): Promise<void>
}

/** The default {@link UpdateEmitter}: publish the update to the bus for live delivery. */
export class PublishingUpdateEmitter implements UpdateEmitter {
    constructor(private readonly publish: UpdatePublish) {}

    async emit(subject: string, update: JsonValue): Promise<void> {
        await this.publish({ subject, update })
    }

    async emitToAuthKey(authKeyId: string, update: JsonValue): Promise<void> {
        await this.publish({ authKeyId, update })
    }
}
