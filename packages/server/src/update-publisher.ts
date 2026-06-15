import { createRedisUpdateBus } from './lib.js'
import type { JsonValue } from '@mt-tl/tl'

/** A standalone publisher returned by {@link createUpdatePublisher}. */
export interface UpdatePublisher {
    /** Push a TL update (`{ _: name, ... }`) to a `subject` (internal user id) —
     * delivered to whatever node holds them. */
    push(subject: string, update: unknown): Promise<void>
    /** Push to a specific auth key — including an anonymous connection (no pts). */
    pushToAuthKey(authKeyId: string, update: unknown): Promise<void>
    /** Disconnect from the shared bus. */
    close(): Promise<void>
}

/** Options for {@link createUpdatePublisher}. */
export interface UpdatePublisherConfig {
    /** Redis URL of the shared pub/sub update bus (the same `REDIS_URL` your servers use). */
    redisUrl: string
}

/**
 * Creates a server-push publisher for code running **outside** the server — a
 * webhook receiver, a cron worker, another microservice. It drops the update on
 * the shared Redis bus; the server fleet's router looks up presence and delivers
 * it to whichever node holds the user (rendered for that client's layer). No
 * client connection and no running server are needed — only the shared bus.
 *
 * Inside a handler, push with `ctx.push(subject, update)` instead — this is for
 * cross-process pushes, which is why it needs the shared `redisUrl`.
 *
 * @example
 * ```ts
 * const updates = await createUpdatePublisher({ redisUrl: process.env.REDIS_URL! })
 * await updates.push(subject, { _: 'updateNewMessage', message })
 * await updates.close()
 * ```
 */
export async function createUpdatePublisher(config: UpdatePublisherConfig): Promise<UpdatePublisher> {
    if (!config.redisUrl) throw new Error('createUpdatePublisher requires redisUrl')
    const handle = await createRedisUpdateBus(config.redisUrl)
    return {
        push: (subject, update) => handle.bus.publishUpdate({ subject, update: update as JsonValue }),
        pushToAuthKey: (authKeyId, update) =>
            handle.bus.publishUpdate({ authKeyId, update: update as JsonValue }),
        close: () => handle.close(),
    }
}
