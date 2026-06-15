import { protocolSchemaDir } from '@mt-tl/tl'
import { loadSchema } from './tl/registry.js'
import { TlCodec } from './tl/codec.js'
import { loadLayeredRegistry } from './tl/layered-registry.js'
import { loadRsaKeyPair } from './crypto/rsa.js'
import { createStorage, type Storage } from './storage/index.js'
import { NonceStore } from './auth/nonce-store.js'
import { Handshake } from './auth/handshake.js'
import { SaltService } from './session/salts.js'
import { Dispatcher } from './dispatch/dispatcher.js'
import { PrintForwarder } from './dispatch/forwarders/print.js'
import type { RpcForwarder } from './dispatch/rpc-forwarder.js'
import { MessagePipeline } from './server/message-pipeline.js'
import { MtprotoWsServer } from './transport/ws-server.js'
import { MtprotoTcpServer } from './transport/tcp-server.js'
import { Connection } from './transport/connection.js'
import { ConnectionRegistry } from './transport/connection-registry.js'
import { NodePresenceBinder, NoopPresenceBinder, type PresenceBinder } from './updates/presence-binder.js'
import { PushService } from './updates/push.js'
import type { Presence } from './updates/presence.js'
import type { UpdateBus } from './updates/update-bus.js'
import type { MTProtoConfig } from './config.js'
import { createLogger, type Logger } from '@mt-tl/tl'
import type { MigrationRegistry } from '@mt-tl/tl'
import type { KeyObject } from 'node:crypto'

export interface Gateway {
    /** Present when `config.wsPort` is set. */
    wsServer?: MtprotoWsServer
    /** Present when `config.tcpPort` is set. */
    tcpServer?: MtprotoTcpServer
    pipeline: MessagePipeline
    storage: Storage
    registry: ConnectionRegistry
    nodeId: string
    fingerprint: bigint
    /** Gateway's RSA public key (clients encrypt pq_inner_data with it). */
    publicKey: KeyObject
    stats: { constructors: number; methods: number; crcMismatches: number; layers: number[] }
    /** Start every configured carrier. */
    listen(): Promise<void>
    close(): Promise<void>
}

export interface BuildOptions {
    forwarder?: RpcForwarder
    /** Structured logger for observability; defaults to env-configured. */
    logger?: Logger
    /** Enables server-push: presence map (Redis in prod, in-memory for tests). */
    presence?: Presence
    /** Update bus this node consumes routed deliveries from (Redis pub/sub in prod). */
    bus?: UpdateBus
    /** Per-predicate migration ladders (input up / output down). */
    migrations?: MigrationRegistry
}

/**
 * Wires the gateway from config: load schema -> codec, RSA key, storage,
 * handshake, dispatcher, pipeline, and the WS carrier. Returns the assembled
 * gateway; call `wsServer.listen()` to start accepting clients.
 */
export async function buildGateway(config: MTProtoConfig, opts: BuildOptions = {}): Promise<Gateway> {
    const logger = opts.logger ?? createLogger({ name: config.nodeId })

    // Merge the framework's protocol schema with the app's business schema — the
    // consumer ships only business `.tl`; the protocol layer lives in @mt-tl/tl.
    const { registry, constructors, methods, crcMismatches } = loadSchema([
        protocolSchemaDir,
        config.schemaDir,
    ])
    const layeredAll = loadLayeredRegistry(config.schemaLayersDir)
    const layered = layeredAll.hasLayers() ? layeredAll : undefined
    // Decode-union: register every layer's constructor ids so older-layer clients
    // decode by id (the name index keeps the newest, so encode is unaffected).
    for (const def of layeredAll.allDefs()) registry.register(def)
    const codec = new TlCodec(registry, layered)
    const rsa = loadRsaKeyPair(config.rsaKeyPath)
    const storage = await createStorage(config.storage)
    const saltService = new SaltService(storage.salts)

    const nonceStore = new NonceStore()
    const handshake = new Handshake({
        codec,
        rsa,
        storage,
        saltService,
        nonceStore,
        defaultLayer: config.defaultLayer,
        logger: logger.child({ scope: 'handshake' }),
    })

    const forwarder = opts.forwarder ?? new PrintForwarder(logger.child({ scope: 'rpc' }))

    // Presence / server-push wiring (no-op unless a presence map is supplied).
    const connRegistry = new ConnectionRegistry()
    const binder: PresenceBinder = opts.presence
        ? new NodePresenceBinder(config.nodeId, connRegistry, opts.presence)
        : new NoopPresenceBinder()

    const migrations = opts.migrations
    const pipeline = new MessagePipeline({
        codec,
        storage,
        handshake,
        saltService,
        defaultLayer: config.defaultLayer,
        binder,
        disableMsgKeyCheck: config.disableMsgKeyCheck,
        disableSeqNoCheck: config.disableSeqNoCheck,
        logger: logger.child({ scope: 'mtproto' }),
    })
    pipeline.dispatcher = new Dispatcher({
        codec,
        registry,
        storage,
        saltService,
        responder: pipeline,
        forwarder,
        binder,
        migrations,
        logger: logger.child({ scope: 'rpc' }),
        disableSeqNoCheck: config.disableSeqNoCheck,
        allowedApiIds: config.allowedApiIds,
    })

    // Consume routed updates addressed to this node and push to local sockets.
    if (opts.bus && opts.presence) {
        const push = new PushService(
            connRegistry,
            pipeline,
            layered,
            migrations,
            logger.child({ scope: 'push' }),
        )
        opts.bus.subscribeNode(config.nodeId, msg => {
            if (msg.authKeyId !== undefined) push.deliverToAuthKey(msg.authKeyId, msg.update)
            else if (msg.subject !== undefined) push.deliver(msg.subject, msg.update)
        })
    }

    // Refresh presence TTL for locally-connected users + auth keys (heartbeat).
    let heartbeat: ReturnType<typeof setInterval> | undefined
    if (opts.presence) {
        const presence = opts.presence
        heartbeat = setInterval(
            () => {
                for (const subject of connRegistry.subjects())
                    void presence.add(subject, config.nodeId).catch(() => {})
                for (const authKeyId of connRegistry.authKeys())
                    void presence.addAuthKey(authKeyId, config.nodeId).catch(() => {})
            },
            Math.max(5_000, Math.floor(config.updates.presenceTtlMs / 3)),
        )
        if (typeof heartbeat.unref === 'function') heartbeat.unref()
    }

    const handlers = {
        onPacket: (packet: Buffer, conn: Connection) => pipeline.handlePacket(packet, conn),
        onClose: (conn: Connection) => binder.unbind(conn),
    }

    const wsServer =
        config.wsPort !== undefined
            ? new MtprotoWsServer(
                  {
                      port: config.wsPort,
                      defaultLayer: config.defaultLayer,
                      trustProxy: config.trustProxy,
                      logger,
                  },
                  handlers,
              )
            : undefined
    const tcpServer =
        config.tcpPort !== undefined
            ? new MtprotoTcpServer(
                  {
                      port: config.tcpPort,
                      defaultLayer: config.defaultLayer,
                      trustProxy: config.trustProxy,
                      logger,
                  },
                  handlers,
              )
            : undefined

    return {
        wsServer,
        tcpServer,
        pipeline,
        storage,
        registry: connRegistry,
        nodeId: config.nodeId,
        fingerprint: rsa.fingerprint,
        publicKey: rsa.publicKey,
        stats: { constructors, methods, crcMismatches, layers: layeredAll.layerNumbers() },
        async listen() {
            await Promise.all([wsServer?.listen(), tcpServer?.listen()])
        },
        async close() {
            if (heartbeat) clearInterval(heartbeat)
            wsServer?.close()
            tcpServer?.close()
            await storage.close()
        },
    }
}
