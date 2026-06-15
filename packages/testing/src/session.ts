import type { KeyObject } from 'node:crypto'
import type { TlObject } from '@mt-tl/tl'
import type { TlCodec } from '@mt-tl/server/testkit'
import { TestClient } from './client/test-client.js'
import { wsTransport, type ClientTransport } from './client/transport.js'

const DEFAULT_INVOKE_TIMEOUT_MS = 10000
const DEFAULT_UPDATE_TIMEOUT_MS = 2000
// While there is outstanding demand, the pump polls the socket on this cadence.
// Frames that arrive between polls are buffered by TestClient (never dropped),
// so a short poll just bounds how fast a waiter is satisfied.
const POLL_MS = 200

// initConnection fields sent when a layer is negotiated; override via ConnectOpts.
const DEFAULT_INIT: Record<string, unknown> = {
    api_id: 1,
    device_model: 'mtproto-testing',
    system_version: 'test',
    app_version: '0.0.0',
    system_lang_code: 'en',
    lang_pack: '',
    lang_code: 'en',
}

/** Options for opening a session. */
export interface ConnectOpts {
    /** Negotiate this TL layer: the first call is wrapped in
     *  `invokeWithLayer(layer, initConnection(..., query))`. Without it the
     *  connection runs at the server's `defaultLayer`. */
    layer?: number
    /** Override the `initConnection` fields (`api_id`, `device_model`, …). */
    initConnection?: Record<string, unknown>
    /** Called after every {@link TestSession.invoke} settles — for request/response
     *  logging (the CLI `--verbose` flag wires this). */
    onInvoke?: (trace: InvokeTrace) => void
    /** Called for every server-PUSH (update) this connection receives — for
     *  logging pushes (the CLI `--verbose` flag wires this). */
    onUpdate?: (update: TlObject) => void
}

/** One `invoke` call's request + outcome, for tracing/logging. */
export interface InvokeTrace {
    method: string
    params: Record<string, unknown>
    /** The decoded `rpc_result` payload (absent if it failed). */
    result?: unknown
    /** The `rpc_error` (absent if it succeeded). */
    error?: { code: number; message: string }
    durationMs: number
}

/** A failed RPC: the server replied `rpc_error`. `code` is the MTProto error code. */
export class RpcError extends Error {
    constructor(
        readonly code: number,
        message: string,
    ) {
        super(message)
        this.name = 'RpcError'
    }
}

/** Predicate (or a bare constructor name) an update must satisfy. */
export type UpdateMatch = string | ((u: TlObject) => boolean)

export interface InvokeOpts {
    /** Override the per-call timeout (ms) waiting for the matching `rpc_result`. */
    timeoutMs?: number
}

export interface ExpectUpdateOpts {
    /** How long (ms) to wait for a matching pushed update. Default 2000. */
    timeoutMs?: number
}

interface Pending {
    resolve(result: unknown): void
    reject(err: Error): void
    timer: ReturnType<typeof setTimeout>
}

interface UpdateWaiter {
    match(u: TlObject): boolean
    resolve(u: TlObject): void
    reject(err: Error): void
    timer: ReturnType<typeof setTimeout>
}

// Server→client messages that are NOT RPC answers or pushed updates — the
// session swallows them. (`rpc_result` is matched to its caller; everything not
// listed here and not `rpc_result`/`msg_container` is treated as an update.)
const SERVICE_NAMES = new Set([
    'new_session_created',
    'msgs_ack',
    'pong',
    'bad_server_salt',
    'bad_msg_notification',
    'msgs_state_info',
    'msgs_all_info',
    'msg_detailed_info',
    'msg_new_detailed_info',
    'future_salts',
    'rpc_answer_unknown',
    'rpc_answer_dropped',
    'rpc_answer_dropped_running',
    'destroy_session_ok',
    'destroy_session_none',
])

/**
 * Ergonomic, framework-agnostic wrapper around {@link TestClient}: one connected,
 * handshaken client with an auto-unwrapping `invoke` and an `expectUpdate` for
 * asserting server-push. A single internal receive loop fans each decrypted
 * message to its waiting caller (`rpc_result` → the matching `invoke`; pushes →
 * `expectUpdate`/an update queue), so concurrent invokes and update assertions
 * never race on the socket.
 *
 * @example
 * ```ts
 * const alice = await server.connect()
 * const cfg = await alice.invoke('help.getConfig')        // → the rpc_result payload
 * await alice.invoke('account.checkFields', { ... })       // throws RpcError on rpc_error
 * const upd = await alice.expectUpdate('updateShort')      // waits for a push
 * ```
 */
export class TestSession {
    private readonly updates: TlObject[] = []
    private readonly updateWaiters: UpdateWaiter[] = []
    private readonly pending = new Map<string, Pending>()
    private pumping = false
    private closed = false
    private initSpec?: { layer: number; init: Record<string, unknown> }
    private readonly negotiated?: number
    private readonly onInvoke?: (trace: InvokeTrace) => void
    private readonly onUpdate?: (update: TlObject) => void

    constructor(
        readonly raw: TestClient,
        opts: ConnectOpts = {},
    ) {
        if (opts.layer !== undefined) {
            this.initSpec = { layer: opts.layer, init: { ...DEFAULT_INIT, ...opts.initConnection } }
            this.negotiated = opts.layer
        }
        this.onInvoke = opts.onInvoke
        this.onUpdate = opts.onUpdate
    }

    /** Connect a WebSocket transport, run the MTProto handshake, return a session. */
    static open(url: string, publicKey: KeyObject, codec: TlCodec, opts?: ConnectOpts): Promise<TestSession> {
        return TestSession.fromTransport(wsTransport(url), publicKey, codec, opts)
    }

    /** Connect over any {@link ClientTransport} (e.g. raw TCP), handshake, return a
     *  session. Use this for stands that aren't plain WebSocket. */
    static async fromTransport(
        transport: ClientTransport,
        publicKey: KeyObject,
        codec: TlCodec,
        opts?: ConnectOpts,
    ): Promise<TestSession> {
        const client = new TestClient(transport, publicKey, codec)
        await client.connect()
        await client.handshake()
        return new TestSession(client, opts)
    }

    /** The TL layer this session negotiated (via {@link ConnectOpts.layer}), or
     *  `undefined` if it runs at the server's default. */
    get negotiatedLayer(): number | undefined {
        return this.negotiated
    }

    /**
     * Call `method` with `params`, returning the decoded `rpc_result` payload.
     * Service messages (`new_session_created`, `msgs_ack`, …) are swallowed and
     * interleaved updates are queued for {@link expectUpdate}. Throws
     * {@link RpcError} if the server answers `rpc_error`.
     */
    invoke<T = TlObject>(
        method: string,
        params: Record<string, unknown> = {},
        opts: InvokeOpts = {},
    ): Promise<T> {
        if (!this.onInvoke) return this.invokeInner<T>(method, params, opts)
        const started = Date.now()
        return this.invokeInner<T>(method, params, opts).then(
            result => {
                this.onInvoke!({ method, params, result, durationMs: Date.now() - started })
                return result
            },
            err => {
                const error =
                    err instanceof RpcError
                        ? { code: err.code, message: err.message }
                        : { code: 0, message: String(err?.message ?? err) }
                this.onInvoke!({ method, params, error, durationMs: Date.now() - started })
                throw err
            },
        )
    }

    private invokeInner<T>(method: string, params: Record<string, unknown>, opts: InvokeOpts): Promise<T> {
        if (this.closed) return Promise.reject(new Error('session is closed'))
        const msgId = this.raw.sendBody(this.wrapInit({ _: method, ...params } as TlObject))
        const key = msgId.toString()
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(key)
                reject(
                    new Error(
                        `invoke ${method} timed out after ${opts.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS}ms`,
                    ),
                )
            }, opts.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS)
            this.pending.set(key, {
                resolve: result => {
                    clearTimeout(timer)
                    resolve(result as T)
                },
                reject: err => {
                    clearTimeout(timer)
                    reject(err)
                },
                timer,
            })
            this.ensurePump()
        })
    }

    /**
     * Wait for a pushed update matching `match` (a predicate, or a bare
     * constructor name like `'updateShort'`). Resolves from already-queued
     * updates first, then from new pushes; rejects on timeout.
     */
    expectUpdate(match: UpdateMatch, opts: ExpectUpdateOpts = {}): Promise<TlObject> {
        const pred = toPredicate(match)
        const queuedIdx = this.updates.findIndex(pred)
        if (queuedIdx >= 0) {
            const [u] = this.updates.splice(queuedIdx, 1)
            return Promise.resolve(u!)
        }
        if (this.closed) return Promise.reject(new Error('session is closed'))
        const timeoutMs = opts.timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS
        return new Promise<TlObject>((resolve, reject) => {
            const waiter: UpdateWaiter = {
                match: pred,
                resolve,
                reject,
                timer: setTimeout(() => {
                    const i = this.updateWaiters.indexOf(waiter)
                    if (i >= 0) this.updateWaiters.splice(i, 1)
                    reject(new Error(`expectUpdate timed out after ${timeoutMs}ms`))
                }, timeoutMs),
            }
            this.updateWaiters.push(waiter)
            this.ensurePump()
        })
    }

    /** Drain and return any updates received but not yet consumed. */
    drainUpdates(): TlObject[] {
        return this.updates.splice(0)
    }

    /** Close the transport and reject any in-flight invoke/expectUpdate. */
    close(): void {
        if (this.closed) return
        this.closed = true
        const err = new Error('session is closed')
        for (const p of this.pending.values()) {
            clearTimeout(p.timer)
            p.reject(err)
        }
        this.pending.clear()
        for (const w of this.updateWaiters.splice(0)) {
            clearTimeout(w.timer)
            w.reject(err)
        }
        this.raw.close()
    }

    /** Wrap the FIRST query in `invokeWithLayer(initConnection(...))` when a layer
     *  was requested; the server sets `conn.ctx.apiLayer` and dispatches the inner
     *  query (the rpc_result still carries the outer msg_id we matched on). */
    private wrapInit(query: TlObject): TlObject {
        const spec = this.initSpec
        if (!spec) return query
        this.initSpec = undefined
        return {
            _: 'invokeWithLayer',
            layer: spec.layer,
            query: { _: 'initConnection', ...spec.init, query },
        } as TlObject
    }

    // --- receive pump --------------------------------------------------------

    private ensurePump(): void {
        if (!this.pumping && !this.closed) void this.pump()
    }

    private async pump(): Promise<void> {
        if (this.pumping) return
        this.pumping = true
        try {
            while (!this.closed && (this.pending.size > 0 || this.updateWaiters.length > 0)) {
                let msg: TlObject
                try {
                    msg = await this.raw.receive(POLL_MS)
                } catch {
                    continue // poll timeout: re-check demand, then keep waiting
                }
                this.dispatch(msg)
            }
        } finally {
            this.pumping = false
        }
    }

    private dispatch(msg: TlObject): void {
        const name = msg._
        if (name === 'rpc_result') {
            const reqId = (msg.req_msg_id as bigint | undefined)?.toString()
            const waiter = reqId ? this.pending.get(reqId) : undefined
            if (!waiter) return // unknown/duplicate answer — drop
            this.pending.delete(reqId!)
            const result = msg.result as TlObject | boolean
            if (result && typeof result === 'object' && result._ === 'rpc_error') {
                waiter.reject(new RpcError(Number(result.error_code), String(result.error_message)))
            } else {
                waiter.resolve(result)
            }
            return
        }
        if (name === 'msg_container') {
            for (const inner of (msg.messages as TlObject[] | undefined) ?? []) {
                if (inner && typeof inner === 'object' && '_' in inner) this.dispatch(inner)
            }
            return
        }
        if (SERVICE_NAMES.has(name)) return
        this.routeUpdate(msg)
    }

    private routeUpdate(update: TlObject): void {
        this.onUpdate?.(update)
        const i = this.updateWaiters.findIndex(w => w.match(update))
        if (i >= 0) {
            const [w] = this.updateWaiters.splice(i, 1)
            clearTimeout(w!.timer)
            w!.resolve(update)
        } else {
            this.updates.push(update)
        }
    }
}

function toPredicate(match: UpdateMatch): (u: TlObject) => boolean {
    return typeof match === 'function' ? match : (u: TlObject) => u._ === match
}
