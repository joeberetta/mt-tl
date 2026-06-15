// The protocol ENGINE's internal API (transport/crypto/session/dispatch wiring).
// Consumers don't import this directly; they use `createServer()` (./create-server),
// which wraps it. Env-free and side-effect-free: the caller builds an MTProtoConfig.
export { bootstrap, type BootstrapOptions, type ForwardHandler, type UpdatePublish } from './bootstrap.js'
export { buildGateway, type Gateway, type BuildOptions } from './gateway.js'
export { type MTProtoConfig } from './config.js'
export { InProcessForwarder } from './dispatch/forwarders/in-process.js'
export {
    createLogger,
    noopLogger,
    type Logger,
    type LogLevel,
    type LoggerOptions,
    type Fields,
} from '@mt-tl/tl'
export type { RpcForwarder } from './dispatch/rpc-forwarder.js'
export type { RpcContext, RpcRequest, RpcResponse, SessionEffect } from '@mt-tl/tl'
export type { UpdateMessage, NodeDelivery } from './updates/types.js'

// Update-delivery adapters — the Redis pub/sub bus + presence behind the
// in-process push loop (multi-instance), and the router that fans updates to nodes.
export { createRedisPresence, type RedisPresenceHandle } from './updates/redis-presence.js'
export { createRedisUpdateBus, type RedisBusHandle } from './updates/redis-bus.js'
export { UpdateRouter, type RouterOptions } from './updates/router.js'
