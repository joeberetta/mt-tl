import { wsTransport } from './transport.js'
import { MtprotoClient } from './mtproto-client.js'
import { buildRegistry, TlCodec, type BObject } from './codec.js'
import { RpcError } from './browser-session.js'
import type { TlDef } from './ir-types.js'

export interface CallResult {
    ok: boolean
    result?: BObject
    error?: { code: number; message: string }
    ms: number
    reqBytes: number
    extras: BObject[] // anything else received (new_session_created, updates…)
}

/**
 * One shared MTProto session for the studio playground: lazily loads `wire.json`
 * (the flat protocol+business registry) to build a browser codec, runs the
 * handshake against the consumer's own ws:// server, and issues encrypted RPCs.
 * The same codec also powers the offline "encode preview" (no connection needed).
 */
export class StudioSession {
    private client?: MtprotoClient
    codec?: TlCodec
    defs: TlDef[] = []
    readonly defsByName = new Map<string, TlDef>()
    readonly ctorsByType = new Map<string, string[]>()

    /** Fetch + index wire.json once. Safe to call repeatedly. */
    async loadWire(): Promise<void> {
        if (this.codec) return
        const res = await fetch('./wire.json')
        if (!res.ok) throw new Error(`wire.json ${res.status} — run "mt-tl-studio build" to generate it`)
        const defs = (await res.json()) as TlDef[]
        this.defs = defs
        this.codec = new TlCodec(buildRegistry(defs))
        for (const d of defs) {
            if (!this.defsByName.has(d.name)) this.defsByName.set(d.name, d)
            if (d.kind === 'constructor') {
                const list = this.ctorsByType.get(d.type) ?? []
                if (!list.includes(d.name)) list.push(d.name)
                this.ctorsByType.set(d.type, list)
            }
        }
    }

    /** Encode a value to wire bytes without sending — for the live preview. */
    encode(body: BObject): Uint8Array {
        if (!this.codec) throw new Error('wire registry not loaded')
        return this.codec.encode(body)
    }

    get connected(): boolean {
        return !!this.client
    }

    async connect(url: string, pubKeyPem: string): Promise<void> {
        await this.loadWire()
        const client = new MtprotoClient(wsTransport(url), pubKeyPem, this.codec!)
        await client.connect()
        await client.handshake()
        this.client = client
    }

    reset(): void {
        this.client?.close()
        this.client = undefined
    }

    /** Send one encrypted request and wait for its rpc_result (matched by req_msg_id). */
    async call(body: BObject): Promise<CallResult> {
        if (!this.client) throw new Error('not connected')
        const reqBytes = this.codec!.encode(body).length
        const t0 = performance.now()
        const msgId = this.client.sendBody(body)
        const extras: BObject[] = []
        for (let i = 0; i < 12; i++) {
            const msg = await this.client.receive()
            const isResult = msg._ === 'rpc_result' && (msg as Record<string, unknown>).req_msg_id === msgId
            if (!isResult) {
                extras.push(msg)
                continue
            }
            const ms = Math.round(performance.now() - t0)
            const res = (msg as Record<string, unknown>).result as BObject
            if (res && res._ === 'rpc_error') {
                const r = res as Record<string, unknown>
                return {
                    ok: false,
                    error: { code: Number(r.error_code), message: String(r.error_message) },
                    ms,
                    reqBytes,
                    extras,
                }
            }
            return { ok: true, result: res, ms, reqBytes, extras }
        }
        throw new Error('no rpc_result received (12 frames)')
    }

    /** RecipeSession surface: invoke that throws on rpc_error (for auth recipes). */
    async invoke(method: string, params: Record<string, unknown> = {}): Promise<BObject> {
        const r = await this.call({ ...params, _: method })
        if (!r.ok) throw new RpcError(r.error!.code, r.error!.message)
        return r.result!
    }

    /** RecipeSession surface: alias of {@link waitFor}. */
    expectUpdate(match: string, timeoutMs = 5000): Promise<BObject> {
        return this.waitFor(match, timeoutMs)
    }

    /** Wait for a server-pushed message whose constructor is `name` (for expectUpdate). */
    async waitFor(name: string, timeoutMs = 5000): Promise<BObject> {
        if (!this.client) throw new Error('not connected')
        for (let i = 0; i < 12; i++) {
            const msg = await this.client.receive(timeoutMs)
            if (msg._ === name) return msg
            // unwrap updates/containers shallowly so updateShort etc. can be matched
            const u = (msg as Record<string, unknown>).update as BObject | undefined
            if (u && u._ === name) return u
        }
        throw new Error(`no "${name}" received`)
    }
}
