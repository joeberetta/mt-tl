/**
 * Per-connection inbound-message guard and state tracker.
 *
 * Implements the client→server half of the MTProto message-id / sequence-number
 * rules (https://core.telegram.org/mtproto/description) and backs the
 * `msgs_state_req` / `msgs_state_info` service messages
 * (https://core.telegram.org/mtproto/service_messages_about_messages).
 *
 * A connection carries a single session's message stream, so one tracker per
 * connection is sufficient. The tracker is purely in-memory: replay protection
 * is per-connection-process, while the time-window check (codes 16/17) bounds
 * cross-process replay since stale msg_ids are rejected everywhere.
 *
 * Sequence-number parity (34/35) and ordering (32) are enforced when `checkSeqNo`
 * / `checkOrder` are set (gated by the `disableSeqNoCheck` config). Code 33 (seqno
 * too high) is unreachable under serial in-order processing; code 64 (invalid
 * container) is raised by the dispatcher. The outer envelope and each
 * container-inner message both run through {@link InboundTracker.accept}. See
 * docs/internals/protocol-compliance.md.
 */

/** `bad_msg_notification` error codes. 16–35 come from {@link InboundTracker.accept};
 *  64 (invalid container) is raised by the dispatcher. */
export type BadMsgCode = 16 | 17 | 18 | 19 | 20 | 32 | 33 | 34 | 35 | 64

/** The cached answer (`rpc_result`) to a request, for `msg_detailed_info`. */
export interface CachedAnswer {
    answerMsgId: bigint
    bytes: number
}

export type AcceptResult =
    | { ok: true }
    /** Reject and reply `bad_msg_notification` with this code. */
    | { ok: false; code: BadMsgCode }
    /** Duplicate of an already-answered request — reply `msg_detailed_info`. */
    | { ok: false; detailed: CachedAnswer }
    /** Benign duplicate with no cached answer — drop silently, send no reply. */
    | { ok: false; drop: true }

/** Classification of an inbound message, derived from its constructor id. */
export interface AcceptOptions {
    /** The payload is a `msg_container` (a duplicate of one is a protocol error → 19). */
    isContainer?: boolean
    /** The message requires acknowledgment (RPC queries); odd seqno expected. */
    contentRelated?: boolean
    /** Enforce seqno parity (codes 34/35). */
    checkSeqNo?: boolean
    /** Enforce content-seqno ordering (code 32). Only the top-level stream — inner
     *  container messages are skipped, since a resend container carries old seqnos. */
    checkOrder?: boolean
}

interface InboundMsg {
    seqNo: number
    /** Odd seqno ⇒ content-related (an RPC query), even ⇒ pure service message. */
    contentRelated: boolean
    /** The reply we generated, once sent — lets a later duplicate get `msg_detailed_info`. */
    answer?: CachedAnswer
}

// Constructor ids of client→server messages that do NOT require acknowledgment
// (carry an even seqno). Everything else is content-related (odd seqno).
const ID_MSG_CONTAINER = 0x73f1f8dc
const NON_CONTENT_IDS = new Set<number>([
    ID_MSG_CONTAINER, // msg_container
    0x62d6b459, // msgs_ack
    0x7abe77ec, // ping
    0xf3427b8c, // ping_delay_disconnect
    0x9299359f, // http_wait
    0x8cc0d131, // msgs_all_info
])

/** Classify a raw payload by its leading constructor id (used to drive `accept`). */
export function messageClass(payload: Buffer): { isContainer: boolean; contentRelated: boolean } {
    if (payload.length < 4) return { isContainer: false, contentRelated: true }
    const id = payload.readUInt32LE(0)
    return { isContainer: id === ID_MSG_CONTAINER, contentRelated: !NON_CONTENT_IDS.has(id) }
}

export interface InboundTrackerOptions {
    /** Clock in milliseconds (default `Date.now`); injectable for tests. */
    nowMs?: () => number
    /** Reject msg_ids whose timestamp is more than this far in the future. */
    futureToleranceSec?: number
    /** Reject msg_ids whose timestamp is more than this far in the past. */
    pastToleranceSec?: number
    /** Size of the recent-msg_id window kept for dedup/state (FIFO eviction). */
    maxTracked?: number
}

// Spec tolerances: a client msg_id encodes unix time in its high 32 bits and must
// be divisible by 4. Telegram ignores ids more than 30s ahead or 300s behind.
const FUTURE_TOLERANCE_SEC = 30
const PAST_TOLERANCE_SEC = 300
const MAX_TRACKED = 1024

export class InboundTracker {
    private readonly received = new Map<bigint, InboundMsg>()
    /** Insertion order, for FIFO eviction once the window is full. */
    private readonly order: bigint[] = []
    /** Highest msg_id evicted from the window — anything ≤ this is "too old to verify". */
    private evictedHigh = 0n
    /** Highest msg_id ever accepted (distinguishes "in range" from "too high"). */
    private maxReceived = 0n
    /** Highest odd seqno of a content-related message seen (for ordering code 32). */
    private lastContentSeqNo = -1

    private readonly now: () => number
    private readonly futureTolerance: number
    private readonly pastTolerance: number
    private readonly maxTracked: number

    constructor(opts: InboundTrackerOptions = {}) {
        this.now = opts.nowMs ?? (() => Date.now())
        this.futureTolerance = opts.futureToleranceSec ?? FUTURE_TOLERANCE_SEC
        this.pastTolerance = opts.pastToleranceSec ?? PAST_TOLERANCE_SEC
        this.maxTracked = Math.max(1, opts.maxTracked ?? MAX_TRACKED)
    }

    /**
     * Validate and record an inbound message. Returns the `bad_msg_notification`
     * error code if the message must be rejected, `{ drop: true }` for a benign
     * duplicate to ignore silently, or `{ ok: true }` if it should be processed. A
     * rejected message is NOT recorded, so the client may correct and resend it
     * (e.g. after a `bad_server_salt`, which re-uses the same msg_id).
     */
    accept(msgId: bigint, seqNo: number, opts: AcceptOptions = {}): AcceptResult {
        const { isContainer = false, contentRelated = true, checkSeqNo = false, checkOrder = false } = opts

        // 18: the two low bits of a client msg_id must be 0 (divisible by 4).
        if ((msgId & 3n) !== 0n) return { ok: false, code: 18 }

        const nowSec = Math.floor(this.now() / 1000)
        const msgSec = Number(msgId >> 32n)
        // 16 / 17: client clock skew beyond tolerance.
        if (msgSec < nowSec - this.pastTolerance) return { ok: false, code: 16 }
        if (msgSec > nowSec + this.futureTolerance) return { ok: false, code: 17 }

        const dup = this.received.get(msgId)
        if (dup) {
            // A duplicate container msg_id is a protocol error (19). For a duplicate
            // regular message: reply `msg_detailed_info` if its answer is still cached,
            // else drop silently — re-processing is unsafe and a bad_msg reply would
            // wrongly make the client resync its clock/salt.
            if (isContainer) return { ok: false, code: 19 }
            return dup.answer ? { ok: false, detailed: dup.answer } : { ok: false, drop: true }
        }
        // 20: older than anything we still remember — can't verify it's not a replay.
        if (msgId <= this.evictedHigh) return { ok: false, code: 20 }

        if (checkSeqNo) {
            const odd = seqNo % 2 === 1
            // 34/35: content-related messages carry an odd seqno, pure service ones even.
            if (contentRelated && !odd) return { ok: false, code: 35 }
            if (!contentRelated && odd) return { ok: false, code: 34 }
        }
        if (checkOrder && contentRelated) {
            // 32: a content-related seqno must exceed every earlier one (they arrive in
            // msg_id order). Code 33 (too high) can't occur under serial processing.
            if (seqNo <= this.lastContentSeqNo) return { ok: false, code: 32 }
            this.lastContentSeqNo = seqNo
        }

        this.note(msgId, seqNo)
        return { ok: true }
    }

    /**
     * Record the reply (`rpc_result`) generated for a request, so a later duplicate
     * of that request can be answered with `msg_detailed_info` instead of dropped.
     * No-op if the request id is no longer tracked.
     */
    recordAnswer(reqMsgId: bigint, answerMsgId: bigint, bytes: number): void {
        const e = this.received.get(reqMsgId)
        if (e) e.answer = { answerMsgId, bytes }
    }

    /**
     * Record a received msg_id without validation. Used for messages observed
     * inside a container (their ids are not individually validated), so that
     * `msgs_state_req` can still report them as received.
     */
    note(msgId: bigint, seqNo: number): void {
        if (this.received.has(msgId)) return
        this.received.set(msgId, { seqNo, contentRelated: seqNo % 2 === 1 })
        this.order.push(msgId)
        if (msgId > this.maxReceived) this.maxReceived = msgId
        while (this.order.length > this.maxTracked) {
            const evicted = this.order.shift()!
            this.received.delete(evicted)
            if (evicted > this.evictedHigh) this.evictedHigh = evicted
        }
    }

    /**
     * Per-id status bytes for `msgs_state_info.info` — one byte per requested id
     * (see the spec's status-byte table). Reports received messages as state 4
     * with the appropriate high bits, and unseen ids as 1/2/3 by position relative
     * to the tracking window.
     */
    stateOf(ids: bigint[]): Buffer {
        const nowSec = Math.floor(this.now() / 1000)
        return Buffer.from(ids.map(id => this.stateByte(id, nowSec)))
    }

    private stateByte(id: bigint, nowSec: number): number {
        const e = this.received.get(id)
        if (e) {
            // 4 = received. Pure service messages don't require an ack (+16);
            // content-related queries are processed and answered (+32 +64).
            return e.contentRelated ? 4 + 32 + 64 : 4 + 16
        }
        const msgSec = Number(id >> 32n)
        // 1 = nothing known (too old / already forgotten); 3 = too high (not yet
        // received); 2 = within the known range but not received.
        if (msgSec < nowSec - this.pastTolerance || id <= this.evictedHigh) return 1
        if (id > this.maxReceived) return 3
        return 2
    }
}
