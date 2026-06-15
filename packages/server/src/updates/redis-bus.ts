import type { NodeDelivery, UpdateMessage } from './types.js'
import type { UpdateBus } from './update-bus.js'

/**
 * Minimal Redis surfaces (for testability). Pub/sub needs TWO connections: a
 * connection in subscriber mode cannot issue regular commands, so publishing and
 * subscribing use separate clients.
 */
export interface RedisPubLike {
    publish(channel: string, message: string): Promise<unknown> | unknown
    quit(): Promise<unknown>
}
export interface RedisSubLike {
    subscribe(channel: string): Promise<unknown> | unknown
    on(event: 'message', listener: (channel: string, message: string) => void): unknown
    quit(): Promise<unknown>
}

const CH_IN = 'updates.in'
const nodeChannel = (nodeId: string) => `updates.node.${nodeId}`

/**
 * Redis pub/sub {@link UpdateBus} for multi-instance server-push (infra stays
 * Mongo + Redis). `updates.in` carries emitted updates to the router;
 * `updates.node.{id}` carries routed deliveries to a node.
 *
 * Caveat: Redis pub/sub is **fan-out**, not a work queue. Per-node channels are
 * fine (one subscriber per nodeId). But `updates.in` is delivered to *every*
 * subscriber — run a SINGLE router with this bus (enough for the in-process-first
 * model), or shard `updates.in` by subject across routers. For competing-consumer
 * semantics at very large scale, switch the bus to Redis Streams.
 */
export class RedisUpdateBus implements UpdateBus {
    private readonly handlers = new Map<string, (msg: unknown) => void>()

    constructor(
        private readonly pub: RedisPubLike,
        private readonly sub: RedisSubLike,
    ) {
        this.sub.on('message', (channel, message) => {
            const handler = this.handlers.get(channel)
            if (!handler) return
            try {
                handler(JSON.parse(message))
            } catch {
                /* drop malformed */
            }
        })
    }

    async publishUpdate(msg: UpdateMessage): Promise<void> {
        await this.pub.publish(CH_IN, JSON.stringify(msg))
    }

    subscribeUpdates(handler: (msg: UpdateMessage) => void): void {
        this.handlers.set(CH_IN, handler as (msg: unknown) => void)
        void this.sub.subscribe(CH_IN)
    }

    async publishToNode(nodeId: string, msg: NodeDelivery): Promise<void> {
        await this.pub.publish(nodeChannel(nodeId), JSON.stringify(msg))
    }

    subscribeNode(nodeId: string, handler: (msg: NodeDelivery) => void): void {
        this.handlers.set(nodeChannel(nodeId), handler as (msg: unknown) => void)
        void this.sub.subscribe(nodeChannel(nodeId))
    }

    async close(): Promise<void> {
        await Promise.all([this.pub.quit().catch(() => {}), this.sub.quit().catch(() => {})])
    }
}

export interface RedisBusHandle {
    bus: RedisUpdateBus
    close: () => Promise<void>
}

/** Connects two Redis clients (publish + subscribe) and builds a {@link RedisUpdateBus}. */
export async function createRedisUpdateBus(url: string): Promise<RedisBusHandle> {
    const IoRedis = (await import('ioredis')).default
    const pub = new IoRedis(url, { lazyConnect: false })
    const sub = new IoRedis(url, { lazyConnect: false })
    const bus = new RedisUpdateBus(pub, sub)
    return { bus, close: () => bus.close() }
}
