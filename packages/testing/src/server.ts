import type { KeyObject } from 'node:crypto'
import {
    createServer,
    type MtprotoServer,
    type MTProtoConfig,
    type MigrationRegistry,
    type RpcMethodSpec,
} from '@mt-tl/server'
import type { TlCodec } from '@mt-tl/server/testkit'
import { createCodec } from './codec.js'
import { TestSession, type ConnectOpts } from './session.js'

export interface TestServerOptions<RM> {
    /** The app's business `.tl` schema directory (protocol schema is auto-merged). */
    schemaDir: string
    /** Per-layer snapshot dir (`scheme_N.json`). Defaults to {@link schemaDir}. */
    schemaLayersDir?: string
    /** Register your routes/plugins, exactly like {@link createServer}. `NoInfer`
     *  keeps `RM` from being pinned to `unknown` by this callback, so the default
     *  applies when you don't pass `createTestServer<RpcMethods>(...)`. */
    register?: (app: MtprotoServer<NoInfer<RM>>) => void
    /** Override config fields (e.g. `defaultLayer`, `wsPort`, `updates.enabled`). */
    config?: Partial<MTProtoConfig>
    /** Per-predicate migration ladders (input `up` / output `down`). */
    migrations?: MigrationRegistry
}

/** A booted in-process server plus everything a test client needs to drive it. */
export interface TestServer<RM> {
    /** The underlying {@link MtprotoServer} (call `.method`/`.inject` as usual). */
    app: MtprotoServer<RM>
    /** WebSocket URL of the ephemeral listener. */
    url: string
    /** The server's RSA public key (clients encrypt the handshake with it). */
    publicKey: KeyObject
    /** A codec over protocol + business schema, for hand-built {@link TestSession}s. */
    codec: TlCodec
    /** Connect a fresh client: transport + handshake done, ready to `invoke`.
     *  Pass `{ layer }` to negotiate a TL layer via `invokeWithLayer`. */
    connect(opts?: ConnectOpts): Promise<TestSession>
    /** Shut the server down. */
    close(): Promise<void>
}

/**
 * Boot the consumer's server **in-process** on an ephemeral port with in-memory
 * storage and in-memory server-push — the foundation for jest/vitest e2e. It
 * uses the real {@link createServer}, so the app under test runs exactly as in
 * production; `connect()` returns an ergonomic {@link TestSession}.
 *
 * @example
 * ```ts
 * const server = await createTestServer<RpcMethods>({
 *   schemaDir, schemaLayersDir: layersDir,
 *   register: app => app.register(myPlugin, deps),
 * })
 * const alice = await server.connect()
 * expect((await alice.invoke('help.getConfig'))._).toBe('config')
 * await server.close()
 * ```
 */
export async function createTestServer<RM = Record<string, RpcMethodSpec>>(
    opts: TestServerOptions<RM>,
): Promise<TestServer<RM>> {
    const config = mergeConfig(opts)
    const app = createServer<RM>(config, { migrations: opts.migrations })
    opts.register?.(app)
    await app.listen()

    const wsPort = app.wsPort
    const publicKey = app.publicKey
    if (wsPort === undefined || publicKey === undefined) {
        await app.close()
        throw new Error('createTestServer: WS carrier did not start (set config.wsPort or leave it default)')
    }
    const codec = createCodec(opts.schemaDir)
    const url = `ws://127.0.0.1:${wsPort}`

    return {
        app,
        url,
        publicKey,
        codec,
        connect: (opts?: ConnectOpts) => TestSession.open(url, publicKey, codec, opts),
        close: () => app.close(),
    }
}

function mergeConfig<RM>(opts: TestServerOptions<RM>): MTProtoConfig {
    const o = opts.config ?? {}
    return {
        nodeId: 'mtproto-test',
        wsPort: 0,
        defaultLayer: 204,
        schemaDir: opts.schemaDir,
        schemaLayersDir: opts.schemaLayersDir ?? opts.schemaDir,
        ...o,
        storage: { backend: 'memory', ...o.storage },
        updates: { enabled: true, presenceTtlMs: 60_000, ...o.updates },
    }
}
