import { buildGateway, type BuildOptions, type Gateway } from './gateway.js'
import { InProcessForwarder } from './dispatch/forwarders/in-process.js'
import { InMemoryUpdateBus, type UpdateBus } from './updates/update-bus.js'
import { InMemoryPresence, type Presence } from './updates/presence.js'
import { createRedisPresence } from './updates/redis-presence.js'
import { createRedisUpdateBus } from './updates/redis-bus.js'
import { createMongoUpdateLog } from './updates/mongo-update-log.js'
import { UpdateRouter } from './updates/router.js'
import { InMemoryUpdateLog, type UpdateLog } from './core/updates.js'
import { createLogger, type Logger } from '@mt-tl/tl'
import type { MTProtoConfig } from './config.js'
import type { RpcRequest, RpcResponse } from './dispatch/rpc-forwarder.js'
import type { UpdateMessage } from './updates/types.js'
import type { MigrationRegistry } from '@mt-tl/tl'

/** The app's forward handler — typically `req => dispatchRpc(app.rpc, req, app.deps)`. */
export type ForwardHandler = (req: RpcRequest) => Promise<RpcResponse>

/** Publishes a server update onto the gateway's push loop (no-op when push is off). */
export type UpdatePublish = (msg: UpdateMessage) => Promise<void>

export interface BootstrapOptions {
    config: MTProtoConfig
    /**
     * Builds the app's forward handler. Receives a `publish` wired to the
     * gateway's in-process push loop and the shared {@link UpdateLog} (durable
     * when `config.updates.managed`) — feed both into the app's update emitter
     * (`new LoggingUpdateEmitter(updateLog, publish)`) so handler-emitted updates
     * reach connected clients and, when managed, persist with a pts.
     */
    createForward: (publish: UpdatePublish, updateLog: UpdateLog) => ForwardHandler
    logger?: Logger
    /** Per-predicate migration ladders (input `up` / output `down`). */
    migrations?: MigrationRegistry
}

/**
 * The in-process-first entrypoint: runs the gateway and an app in ONE process.
 * The app is reached via an {@link InProcessForwarder} (no broker). When
 * `config.updates.enabled`, server-push is wired in-process: the app's
 * `publish` → update bus → {@link UpdateRouter} (presence lookup) → this node →
 * client. Uses an in-memory bus/presence for a single process, or Redis (pub/sub
 * bus + presence) when `config.updates.redisUrl` is set (then scale
 * horizontally). Returns the gateway; call `listen()`.
 */
export async function bootstrap(opts: BootstrapOptions): Promise<Gateway> {
    const logger = opts.logger ?? createLogger({ name: opts.config.nodeId })
    const buildOpts: BuildOptions = { logger, migrations: opts.migrations }
    const closers: Array<() => Promise<void>> = []
    let publish: UpdatePublish = async () => {}

    if (opts.config.updates.enabled) {
        const presence = await makePresence(opts.config)
        const bus = await makeBus(opts.config)
        new UpdateRouter(bus.bus, presence.presence).start()
        publish = msg => bus.bus.publishUpdate(msg)
        buildOpts.presence = presence.presence
        buildOpts.bus = bus.bus
        closers.push(bus.close, presence.close)
        logger.info('updates.inprocess', {
            backend: opts.config.updates.redisUrl ? 'redis' : 'memory',
        })
    }

    // Update state (pts log). Durable + engine-answered when `updates.managed`.
    const updateLog = await makeUpdateLog(opts.config)
    closers.push(updateLog.close)
    buildOpts.updateLog = updateLog.log
    buildOpts.managedUpdates = !!opts.config.updates.managed

    buildOpts.forwarder = new InProcessForwarder(opts.createForward(publish, updateLog.log))
    const gateway = await buildGateway(opts.config, buildOpts)

    // Extend close() to also tear down the in-process update infra.
    const closeGateway = gateway.close.bind(gateway)
    gateway.close = async () => {
        await closeGateway()
        for (const close of closers) await close().catch(() => {})
    }
    return gateway
}

/** In-memory for a single process; Redis once `redisUrl` is set (multi-instance). */
async function makePresence(
    config: MTProtoConfig,
): Promise<{ presence: Presence; close: () => Promise<void> }> {
    const u = config.updates
    if (!u.redisUrl) return { presence: new InMemoryPresence(), close: async () => {} }
    return createRedisPresence(u.redisUrl, u.presenceTtlMs)
}

async function makeBus(config: MTProtoConfig): Promise<{ bus: UpdateBus; close: () => Promise<void> }> {
    const u = config.updates
    if (!u.redisUrl) {
        const bus = new InMemoryUpdateBus()
        return { bus, close: () => bus.close() }
    }
    return createRedisUpdateBus(u.redisUrl)
}

/**
 * The pts log behind `ctx.push` and (when `updates.managed`) `updates.getState`/
 * `getDifference`. Durable on Mongo when managed + `storage.backend: 'mongo'`;
 * in-memory otherwise (the emitter still uses it to stamp a pts).
 */
async function makeUpdateLog(config: MTProtoConfig): Promise<{ log: UpdateLog; close: () => Promise<void> }> {
    if (config.updates.managed && config.storage.backend === 'mongo') {
        if (!config.storage.mongoUrl || !config.storage.mongoDb) {
            throw new Error('updates.managed with mongo storage requires MONGO_URL and MONGO_DB')
        }
        return createMongoUpdateLog(config.storage.mongoUrl, config.storage.mongoDb)
    }
    return { log: new InMemoryUpdateLog(), close: async () => {} }
}
