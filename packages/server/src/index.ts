// @mt-tl/server — the consumer-facing framework facade. Install this (plus
// @mt-tl/tl for codegen) to build an MTProto server: define routes, listen.
// The protocol engine (transport/crypto/session/dispatch) and the handler layer
// (registry/dispatch/hooks/context/errors, under ./core) live in this same
// package; this file re-exports just the consumer surface — not the internal
// event/job/runner machinery.

export * from './create-server.js' // createServer, definePlugin, MtprotoServer, Plugin, MethodOpts/Handler
export * from './update-publisher.js' // createUpdatePublisher

// Handler surface (curated from ./core).
export {
    // errors → rpc_error
    AppError,
    BadRequestError,
    AuthRequiredError,
    NotFoundError,
    FloodWaitError,
    InternalError,
    // hooks
    defineHook,
    type Hook,
    // dispatch + registry (for tests / advanced wiring)
    RpcRegistry,
    dispatchRpc,
    type DispatchDeps,
    // context + typing
    type HandlerCtx,
    type RpcMethodSpec,
    type RpcMethodMap,
    type RpcModule,
    type UpdateEmitter,
} from './core/index.js'

// The system config object the server takes.
export type { MTProtoConfig } from './lib.js'

// The initConnection audit/validation hook — createServer(config, { onInitConnection }).
export type { OnInitConnection, InitConnectionInfo } from './lib.js'

// Structured logger (re-exported from @mt-tl/tl) — build one with createLogger
// and pass it to createServer, or use the same factory in your app code for a
// unified log style. Handlers get a per-request child via `ctx.log`; the server
// exposes its root logger as `app.log`. See docs/guide/observability.md.
export {
    createLogger,
    noopLogger,
    type Logger,
    type LogLevel,
    type LoggerOptions,
    type Fields,
} from './lib.js'

// Schema-version migration ladders (input `up` / output `down`) — pass via
// createServer(config, { migrations }). See docs/guide/releasing-a-version.md.
export { MigrationRegistry, type MigrationRung } from '@mt-tl/tl'
