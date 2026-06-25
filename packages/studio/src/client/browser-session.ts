import { MtprotoClient } from './mtproto-client.js'
import { wsTransport, obfuscatedWsTransport, type ClientTransport } from './transport.js'
import type { TlCodec, BObject } from './codec.js'

// Browser port of @mt-tl/testing's TestSession: an ergonomic wrapper over the
// low-level MtprotoClient with a single receive-pump, auto-unwrapping invoke,
// layer negotiation (invokeWithLayer→initConnection), and expectUpdate. Keep in
// sync with packages/testing/src/session.ts.

const KEEPALIVE_MS = 30000
const DEFAULT_INVOKE_TIMEOUT_MS = 10000
const DEFAULT_UPDATE_TIMEOUT_MS = 3000
const POLL_MS = 200

const DEFAULT_INIT: Record<string, unknown> = {
    api_id: 1,
    device_model: 'mt-tl-studio',
    system_version: 'web',
    app_version: '0.0.0',
    system_lang_code: 'en',
    lang_pack: '',
    lang_code: 'en',
}

export interface ConnectOpts {
    /** Negotiate this TL layer: the first call is wrapped in
     *  `invokeWithLayer(layer, initConnection(..., query))`. */
    layer?: number
    initConnection?: Record<string, unknown>
    onUpdate?: (update: BObject) => void
    /** Use the obfuscated WebSocket transport (required to reach real Telegram). */
    obfuscated?: boolean
}

export type UpdateMatch = string | ((u: BObject) => boolean)

/** A failed RPC: the server replied `rpc_error`. */
export class RpcError extends Error {
    constructor(
        readonly code: number,
        message: string,
    ) {
        super(message)
        this.name = 'RpcError'
    }
}

interface Pending {
    resolve(result: unknown): void
    reject(err: Error): void
    timer: ReturnType<typeof setTimeout>
}
interface UpdateWaiter {
    match(u: BObject): boolean
    resolve(u: BObject): void
    reject(err: Error): void
    timer: ReturnType<typeof setTimeout>
}

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

export class BrowserSession {
    private readonly updates: BObject[] = []
    private readonly updateWaiters: UpdateWaiter[] = []
    private readonly pending = new Map<string, Pending>()
    private pumping = false
    private closed = false
    private listening = false
    private initSpec?: { layer: number; init: Record<string, unknown> }
    private readonly negotiated?: number
    private onUpdate?: (update: BObject) => void
    private keepalive?: ReturnType<typeof setInterval>

    constructor(
        readonly raw: MtprotoClient,
        opts: ConnectOpts = {},
    ) {
        if (opts.layer !== undefined) {
            this.initSpec = { layer: opts.layer, init: { ...DEFAULT_INIT, ...opts.initConnection } }
            this.negotiated = opts.layer
        }
        this.onUpdate = opts.onUpdate
        // Keepalive: real servers idle-close (~30s). Ping periodically so the shared
        // session survives between calls. ping_delay_disconnect also asks the server
        // to hold the connection for `disconnect_delay`s. The pong is swallowed by the
        // pump (or buffered harmlessly until the next receive).
        this.keepalive = setInterval(() => {
            if (this.closed) return
            try {
                this.raw.sendBody({ _: 'ping_delay_disconnect', ping_id: BigInt(Date.now()), disconnect_delay: 75 } as BObject)
            } catch {
                /* ignore — a dead socket surfaces via onClose */
            }
        }, KEEPALIVE_MS)
    }

    /** Connect a WebSocket transport, handshake, return a session. */
    static open(url: string, publicKeyPem: string, codec: TlCodec, opts?: ConnectOpts): Promise<BrowserSession> {
        const transport = opts?.obfuscated ? obfuscatedWsTransport(url) : wsTransport(url)
        return BrowserSession.fromTransport(transport, publicKeyPem, codec, opts)
    }

    static async fromTransport(
        transport: ClientTransport,
        publicKeyPem: string,
        codec: TlCodec,
        opts?: ConnectOpts,
    ): Promise<BrowserSession> {
        const client = new MtprotoClient(transport, publicKeyPem, codec, opts?.obfuscated)
        await client.connect()
        await client.handshake()
        return new BrowserSession(client, opts)
    }

    get negotiatedLayer(): number | undefined {
        return this.negotiated
    }

    /** Register a callback for when the underlying socket closes (server drop / network loss). */
    onClose(cb: () => void): void {
        this.raw.onClose(cb)
    }

    /** Call `method` with `params`, returning the decoded rpc_result payload.
     *  Throws {@link RpcError} on rpc_error. `opts.onSent(msgId)` fires with the request's
     *  msg_id the moment it's sent (so callers can log/correlate it). */
    invoke(
        method: string,
        params: Record<string, unknown> = {},
        opts: { timeoutMs?: number; onSent?: (msgId: bigint) => void } = {},
    ): Promise<BObject> {
        if (this.closed) return Promise.reject(new Error('session is closed'))
        const timeoutMs = opts.timeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS
        const msgId = this.raw.sendBody(this.wrapInit({ _: method, ...params } as BObject))
        opts.onSent?.(msgId)
        const key = msgId.toString()
        return new Promise<BObject>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(key)
                reject(new Error(`invoke ${method} timed out after ${timeoutMs}ms`))
            }, timeoutMs)
            this.pending.set(key, {
                resolve: result => {
                    clearTimeout(timer)
                    resolve(result as BObject)
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

    /** Wait for a pushed update matching `match` (a predicate or a bare ctor name). */
    expectUpdate(match: UpdateMatch, timeoutMs = DEFAULT_UPDATE_TIMEOUT_MS): Promise<BObject> {
        const pred = toPredicate(match)
        const queuedIdx = this.updates.findIndex(pred)
        if (queuedIdx >= 0) {
            const [u] = this.updates.splice(queuedIdx, 1)
            return Promise.resolve(u!)
        }
        if (this.closed) return Promise.reject(new Error('session is closed'))
        return new Promise<BObject>((resolve, reject) => {
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

    /** Updates received but not matched/consumed by an expectUpdate yet — for
     *  diagnostics (e.g. show what DID arrive when an expectUpdate times out). */
    get bufferedUpdates(): BObject[] {
        return [...this.updates]
    }

    /** Keep the receive loop alive and route EVERY pushed update to `onUpdate`
     *  (for the Listen tool) until {@link stopListening} or {@link close}. */
    listen(onUpdate: (update: BObject) => void): void {
        this.onUpdate = onUpdate
        this.listening = true
        this.ensurePump()
    }
    stopListening(): void {
        this.listening = false
        this.onUpdate = undefined
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        this.listening = false
        if (this.keepalive) clearInterval(this.keepalive)
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

    /** Wrap the FIRST query in invokeWithLayer(initConnection(...)) when a layer was requested. */
    private wrapInit(query: BObject): BObject {
        const spec = this.initSpec
        if (!spec) return query
        this.initSpec = undefined
        return {
            _: 'invokeWithLayer',
            layer: spec.layer,
            query: { _: 'initConnection', ...spec.init, query },
        } as BObject
    }

    private ensurePump(): void {
        if (!this.pumping && !this.closed) void this.pump()
    }

    private async pump(): Promise<void> {
        if (this.pumping) return
        this.pumping = true
        try {
            while (!this.closed && (this.pending.size > 0 || this.updateWaiters.length > 0 || this.listening)) {
                let msg: BObject
                try {
                    msg = await this.raw.receive(POLL_MS)
                } catch {
                    continue // poll timeout: re-check demand
                }
                this.dispatch(msg)
            }
        } finally {
            this.pumping = false
        }
    }

    private dispatch(msg: BObject): void {
        const name = msg._
        if (name === 'rpc_result') {
            const reqId = (msg as Record<string, unknown>).req_msg_id as bigint | undefined
            const key = reqId?.toString()
            const waiter = key ? this.pending.get(key) : undefined
            if (!waiter) return
            this.pending.delete(key!)
            const result = (msg as Record<string, unknown>).result as BObject | boolean
            if (result && typeof result === 'object' && result._ === 'rpc_error') {
                const r = result as Record<string, unknown>
                waiter.reject(new RpcError(Number(r.error_code), String(r.error_message)))
            } else {
                waiter.resolve(result)
            }
            return
        }
        if (name === 'msg_container') {
            for (const inner of ((msg as Record<string, unknown>).messages as BObject[] | undefined) ?? []) {
                if (inner && typeof inner === 'object' && '_' in inner) this.dispatch(inner)
            }
            return
        }
        if (SERVICE_NAMES.has(name)) return
        this.routeUpdate(msg)
    }

    private routeUpdate(update: BObject): void {
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

function toPredicate(match: UpdateMatch): (u: BObject) => boolean {
    return typeof match === 'function' ? match : (u: BObject) => u._ === match
}
