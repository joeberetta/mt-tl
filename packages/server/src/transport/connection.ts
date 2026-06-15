import { noopLogger, type Logger } from '@mt-tl/tl'
import { Framing } from './framing.js'
import { nextMessageId, nextSeqNo, type MsgIdState } from '../session/message-id.js'
import { InboundTracker } from '../session/inbound-tracker.js'

/**
 * Per-connection state. Holds transport framing, the negotiated TL layer,
 * auth-key/session binding (filled after the handshake and first encrypted
 * message), and outgoing message-id/seq counters.
 */
export interface ConnectionCtx extends MsgIdState {
    connectionId: number
    remoteAddress?: string
    apiLayer: number

    authKeyId?: bigint
    authKey?: Buffer
    sessionId?: bigint
    uniqueId?: bigint
    serverSalt?: bigint

    // Captured from `initConnection` (and persisted onto the auth key's meta).
    apiId?: number
    deviceModel?: string
    systemVersion?: string
    appVersion?: string
    systemLangCode?: string
    langCode?: string
    /** Bound subject (internal user id) once the auth key is authorized. */
    subject?: string

    /** Set when the client wrapped a query in `invokeWithoutUpdates` — this
     * connection is excluded from server-push delivery. */
    noUpdates?: boolean
}

export class Connection {
    readonly id: number
    /** Per-connection logger (carrier-scoped child); also passed to framing. */
    readonly log: Logger
    readonly framing: Framing
    /** Inbound msg_id/seqno validation + received-message state (per session). */
    readonly tracker = new InboundTracker()
    ctx: ConnectionCtx
    closed = false
    private tail: Promise<void> = Promise.resolve()
    /** Idle-disconnect window (ms) requested via `ping_delay_disconnect`; 0 = none. */
    private disconnectMs = 0
    private disconnectTimer?: ReturnType<typeof setTimeout>

    constructor(
        id: number,
        private readonly transportSend: (bytes: Buffer) => void,
        private readonly transportClose: () => void,
        remoteAddress?: string,
        defaultLayer = 204,
        log: Logger = noopLogger,
    ) {
        this.id = id
        this.log = log
        this.framing = new Framing(log)
        this.ctx = {
            connectionId: id,
            remoteAddress,
            apiLayer: defaultLayer,
            lastMessageId: null,
            messageSeqNo: 0,
        }
    }

    /** Frame a fully-built MTProto packet (plaintext or encrypted) and send it. */
    send(packet: Buffer): void {
        if (this.closed) return
        this.transportSend(this.framing.frame(packet))
    }

    nextMessageId(isNotification = false): bigint {
        return nextMessageId(this.ctx, isNotification)
    }

    nextSeqNo(contentRelated = true): number {
        return nextSeqNo(this.ctx, contentRelated)
    }

    /** Serialize async work per connection so messages are processed in order. */
    enqueue(fn: () => void | Promise<void>): void {
        this.tail = this.tail.then(fn).catch(() => {})
    }

    /**
     * Arm (or re-arm) the `ping_delay_disconnect` idle timer: close the connection
     * after `delaySec` seconds of inactivity. A delay of 0 disarms it.
     */
    armDisconnect(delaySec: number): void {
        this.disconnectMs = Math.max(0, Math.floor(delaySec)) * 1000
        this.resetDisconnect()
    }

    /** Reset the idle timer on activity. No-op unless armed via {@link armDisconnect}. */
    resetDisconnect(): void {
        if (this.disconnectTimer) clearTimeout(this.disconnectTimer)
        if (!this.disconnectMs) return
        this.disconnectTimer = setTimeout(() => this.close(), this.disconnectMs)
        if (typeof this.disconnectTimer.unref === 'function') this.disconnectTimer.unref()
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        if (this.disconnectTimer) clearTimeout(this.disconnectTimer)
        this.transportClose()
    }
}
