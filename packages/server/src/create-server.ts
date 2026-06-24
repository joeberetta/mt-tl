import type { KeyObject } from 'node:crypto'
import {
    bootstrap,
    type MTProtoConfig,
    type Gateway,
    type UpdatePublish,
    type OnInitConnection,
} from './lib.js'
import {
    createLogger,
    type Logger,
    type MigrationRegistry,
    type RpcRequest,
    type RpcResponse,
} from '@mt-tl/tl'
import {
    RpcRegistry,
    dispatchRpc,
    PublishingUpdateEmitter,
    type Hook,
    type HandlerCtx,
    type RpcMethodSpec,
    type UpdateEmitter,
} from './core/index.js'

/** Per-method options. */
export interface MethodOpts {
    /** Require an authorized auth key (a bound `subject`). Defaults to `true`. */
    auth?: boolean
    /** Reusable pre-handlers, run in order before the handler (see `defineHook`). */
    preHandlers?: Hook[]
}

/** A handler for method `M` of the app's generated method map `RM`. */
export type MethodHandler<RM, M extends keyof RM> = RM[M] extends RpcMethodSpec
    ? (params: RM[M]['params'], ctx: HandlerCtx) => Promise<RM[M]['result']>
    : never

/** A plugin: registers routes on the server, given its declared dependencies. */
export type Plugin<RM, D = void> = (app: MtprotoServer<RM>, deps: D) => void

/**
 * The server instance (Fastify-style): register routes and listen. It wraps the
 * MTProto engine + the in-process handler dispatch — there is no broker and no
 * separate "worker" to wire. Generic over the app's generated `RpcMethods` so
 * `.method()` infers `params`/`result` (and the method name) per method.
 */
export interface MtprotoServer<RM = Record<string, RpcMethodSpec>> {
    /** Register a route. `auth` defaults to true. */
    method<M extends keyof RM>(name: M, handler: MethodHandler<RM, M>): this
    method<M extends keyof RM>(name: M, opts: MethodOpts, handler: MethodHandler<RM, M>): this
    /** Run a plugin, passing its dependencies by value (Style-A DI; omit for `void` deps). */
    register<D = void>(plugin: Plugin<RM, D>, deps?: D): this
    /** Open the configured transports (and the in-process push loop if enabled). */
    listen(): Promise<void>
    close(): Promise<void>
    /** Dispatch a request against the registry without a socket — for tests. */
    inject(req: RpcRequest): Promise<RpcResponse>
    /** The server's root logger — use it (or `ctx.log` in a handler) for a unified log style. */
    readonly log: Logger
    /** Registered method names. */
    readonly methods: string[]
    /** Bound WebSocket port after {@link listen} (resolves `wsPort: 0`); else `undefined`. */
    readonly wsPort: number | undefined
    /** Bound raw-TCP port after {@link listen} (resolves `tcpPort: 0`); else `undefined`. */
    readonly tcpPort: number | undefined
    /** The server's RSA public key after {@link listen}; clients encrypt the handshake with it. */
    readonly publicKey: KeyObject | undefined
}

const noopEmitter: UpdateEmitter = { async emit() {}, async emitToAuthKey() {} }

/**
 * Creates an MTProto server (Fastify-style). Pass the {@link MTProtoConfig},
 * register routes with `.method()` / plugins with `.register()`, then
 * `await app.listen()`. The framework owns the whole protocol — transport,
 * handshake, crypto, sessions, TL (de)serialization, layered encoding,
 * server-push — you write methods.
 *
 * Type it with your generated `RpcMethods` (`createServer<RpcMethods>(config)`)
 * so every route's name, `params`, and `result` are checked.
 *
 * @param config - the server configuration (your app builds it from env).
 * @param opts.registry - adopt an existing {@link RpcRegistry} instead of a fresh one (advanced/tests).
 * @param opts.migrations - per-layer migration ladders applied on input/output.
 * @param opts.logger - structured logger; defaults to `createLogger({ name: config.nodeId })`
 *   (env-configured via `LOG_LEVEL`/`LOG_FORMAT`). Exposed as `app.log`; handlers get `ctx.log`.
 *
 * @example
 * ```ts
 * const app = createServer<RpcMethods>(config)
 * app.method('help.getConfig', { auth: false }, async () => ({ _: 'config' }))
 * await app.listen()   // opens the WS + raw-TCP carriers
 * ```
 */
export function createServer<RM = Record<string, RpcMethodSpec>>(
    config: MTProtoConfig,
    opts: {
        registry?: RpcRegistry
        migrations?: MigrationRegistry
        logger?: Logger
        /** Audit/validation hook fired on `initConnection` (throw to reject). */
        onInitConnection?: OnInitConnection
    } = {},
): MtprotoServer<RM> {
    const registry = opts.registry ?? new RpcRegistry()
    const logger = opts.logger ?? createLogger({ name: config.nodeId })
    let gateway: Gateway | undefined
    let emitter: UpdateEmitter = noopEmitter

    const app: MtprotoServer<RM> = {
        method(
            name: keyof RM,
            optsOrHandler: MethodOpts | Function,
            maybeHandler?: Function,
        ): MtprotoServer<RM> {
            const handler = (maybeHandler ?? optsOrHandler) as (
                params: unknown,
                ctx: HandlerCtx,
            ) => Promise<unknown>
            const methodOpts: MethodOpts = maybeHandler ? (optsOrHandler as MethodOpts) : {}
            registry.add({
                [name as string]: {
                    auth: methodOpts.auth ?? true,
                    preHandlers: methodOpts.preHandlers,
                    handler,
                },
            })
            return app
        },
        register<D = void>(plugin: Plugin<RM, D>, deps?: D): MtprotoServer<RM> {
            plugin(app, deps as D)
            return app
        },
        async listen(): Promise<void> {
            if (gateway) throw new Error('server already listening')
            gateway = await bootstrap({
                config,
                migrations: opts.migrations,
                onInitConnection: opts.onInitConnection,
                logger,
                createForward: (publish: UpdatePublish) => {
                    // Handler-emitted updates (ctx.push) flow to the push loop for live,
                    // best-effort delivery — no durable log.
                    emitter = new PublishingUpdateEmitter(publish)
                    return req => dispatchRpc(registry, req, { updates: emitter, logger })
                },
            })
            await gateway.listen()
        },
        async close(): Promise<void> {
            await gateway?.close()
        },
        inject(req: RpcRequest): Promise<RpcResponse> {
            return dispatchRpc(registry, req, { updates: emitter, logger })
        },
        get log(): Logger {
            return logger
        },
        get methods(): string[] {
            return registry.methods()
        },
        get wsPort(): number | undefined {
            return gateway?.wsServer?.port
        },
        get tcpPort(): number | undefined {
            return gateway?.tcpServer?.port
        },
        get publicKey(): KeyObject | undefined {
            return gateway?.publicKey
        },
    }
    return app
}

/**
 * Authoring helper for a typed plugin — a function that registers a group of
 * related routes, taking its dependencies by value (Style-A DI, like
 * `fastify.register`). Pin it to your `RpcMethods` once (see your app's
 * `framework.ts`) so routes inside infer their types.
 *
 * @example
 * ```ts
 * export const walletsPlugin = definePlugin<RpcMethods, { wallets: WalletService }>(
 *   (app, { wallets }) => {
 *     app.method('wallets.getBalance', async (_p, ctx) => wallets.balanceOf(ctx.subject!))
 *   },
 * )
 * app.register(walletsPlugin, { wallets: new WalletService() })
 * ```
 */
export function definePlugin<RM = Record<string, RpcMethodSpec>, D = void>(fn: Plugin<RM, D>): Plugin<RM, D> {
    return fn
}
