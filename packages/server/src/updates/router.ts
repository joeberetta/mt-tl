import type { JsonValue } from '@mt-tl/tl'
import type { Presence } from './presence.js'
import type { UpdateBus } from './update-bus.js'
import type { UpdateMessage } from './types.js'

export interface RouterOptions {
    /**
     * Anti-DDoS valve: return false to drop/coalesce an update under load.
     * Safe to drop — clients recover via pts/getDifference. Default: deliver all.
     */
    shouldDeliver?: (subject: string, update: JsonValue) => boolean
    onError?: (err: unknown, msg: UpdateMessage) => void
}

/**
 * Presence-aware Update Router (standalone service, shard by subject in prod).
 * Consumes worker updates, looks up which nodes hold the subject, and delivers
 * only to those nodes — so 8 idle nodes never receive an update for a subject on
 * node 1. This is the single place to throttle/coalesce per subject.
 */
export class UpdateRouter {
    constructor(
        private readonly bus: UpdateBus,
        private readonly presence: Presence,
        private readonly opts: RouterOptions = {},
    ) {}

    start(): void {
        this.bus.subscribeUpdates(msg => {
            void this.route(msg).catch(err => this.opts.onError?.(err, msg))
        })
    }

    private async route(msg: UpdateMessage): Promise<void> {
        // Auth-key-addressed delivery (anonymous connection); skips the per-user valve.
        if (msg.authKeyId !== undefined) {
            const nodes = await this.presence.lookupAuthKey(msg.authKeyId)
            await Promise.all(
                nodes.map(nodeId =>
                    this.bus.publishToNode(nodeId, { authKeyId: msg.authKeyId, update: msg.update }),
                ),
            )
            return
        }
        if (msg.subject === undefined) return
        if (this.opts.shouldDeliver && !this.opts.shouldDeliver(msg.subject, msg.update)) return
        const nodes = await this.presence.lookup(msg.subject)
        await Promise.all(
            nodes.map(nodeId => this.bus.publishToNode(nodeId, { subject: msg.subject, update: msg.update })),
        )
    }
}
