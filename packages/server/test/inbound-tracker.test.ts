import { describe, it, expect } from 'vitest'
import { InboundTracker } from '../src/session/inbound-tracker.js'

/**
 * Unit coverage for the inbound msg_id/seqno guard that drives
 * `bad_msg_notification` and `msgs_state_req` (spec:
 * https://core.telegram.org/mtproto/description and
 * .../service_messages_about_messages).
 */

const NOW_SEC = 1_700_000_000
const NOW_MS = NOW_SEC * 1000

/** Build a msg_id: high 32 bits = unix seconds, low 32 bits = `low` (lower 2 set
 *  the divisible-by-4 bits). */
const id = (sec: number, low = 0): bigint => (BigInt(sec) << 32n) | BigInt(low)

const mk = (opts = {}) => new InboundTracker({ nowMs: () => NOW_MS, ...opts })

describe('InboundTracker.accept — bad_msg_notification codes', () => {
    it('accepts a fresh, in-window, divisible-by-4 msg_id', () => {
        expect(mk().accept(id(NOW_SEC, 0), 1)).toEqual({ ok: true })
    })

    it('code 18: msg_id not divisible by 4', () => {
        expect(mk().accept(id(NOW_SEC, 1), 1)).toEqual({ ok: false, code: 18 })
        expect(mk().accept(id(NOW_SEC, 2), 1)).toEqual({ ok: false, code: 18 })
    })

    it('code 16: msg_id too far in the past', () => {
        expect(mk().accept(id(NOW_SEC - 301, 0), 1)).toEqual({ ok: false, code: 16 })
        // 300s in the past is still inside the tolerance.
        expect(mk().accept(id(NOW_SEC - 300, 0), 1)).toEqual({ ok: true })
    })

    it('code 17: msg_id too far in the future', () => {
        expect(mk().accept(id(NOW_SEC + 31, 0), 1)).toEqual({ ok: false, code: 17 })
        // 30s in the future is still inside the tolerance.
        expect(mk().accept(id(NOW_SEC + 30, 0), 1)).toEqual({ ok: true })
    })

    it('code 19: duplicate of a CONTAINER msg_id is a protocol error', () => {
        const t = mk()
        expect(t.accept(id(NOW_SEC, 0), 0, { isContainer: true })).toEqual({ ok: true })
        expect(t.accept(id(NOW_SEC, 0), 0, { isContainer: true })).toEqual({ ok: false, code: 19 })
    })

    it('duplicate of a regular message with no cached answer is dropped silently', () => {
        const t = mk()
        expect(t.accept(id(NOW_SEC, 0), 1)).toEqual({ ok: true })
        expect(t.accept(id(NOW_SEC, 0), 1)).toEqual({ ok: false, drop: true })
    })

    it('duplicate of an answered request returns msg_detailed_info', () => {
        const t = mk()
        const req = id(NOW_SEC, 0)
        expect(t.accept(req, 1)).toEqual({ ok: true })
        t.recordAnswer(req, id(NOW_SEC + 1, 1), 128) // server answered it
        expect(t.accept(req, 1)).toEqual({
            ok: false,
            detailed: { answerMsgId: id(NOW_SEC + 1, 1), bytes: 128 },
        })
    })

    it('code 20: msg_id older than the tracking window (evicted, cannot verify)', () => {
        const t = mk({ maxTracked: 2 })
        t.accept(id(NOW_SEC, 0), 1)
        t.accept(id(NOW_SEC, 4), 1)
        t.accept(id(NOW_SEC, 8), 1) // evicts id(NOW_SEC, 0) → evictedHigh
        expect(t.accept(id(NOW_SEC, 0), 1)).toEqual({ ok: false, code: 20 })
    })
})

describe('InboundTracker.accept — seqno validation (checkSeqNo)', () => {
    const seq = { checkSeqNo: true }

    it('code 35: content-related message with an even seqno', () => {
        expect(mk().accept(id(NOW_SEC, 0), 2, { contentRelated: true, ...seq })).toEqual({
            ok: false,
            code: 35,
        })
    })

    it('code 34: non-content message with an odd seqno', () => {
        expect(mk().accept(id(NOW_SEC, 0), 1, { contentRelated: false, ...seq })).toEqual({
            ok: false,
            code: 34,
        })
    })

    it('code 32: content-related seqno not strictly increasing (only when checkOrder)', () => {
        const ord = { contentRelated: true, checkSeqNo: true, checkOrder: true }
        const t = mk()
        expect(t.accept(id(NOW_SEC, 0), 3, ord)).toEqual({ ok: true })
        expect(t.accept(id(NOW_SEC, 4), 3, ord)).toEqual({ ok: false, code: 32 })
        expect(t.accept(id(NOW_SEC, 8), 1, ord)).toEqual({ ok: false, code: 32 })
    })

    it('ordering (32) is NOT enforced when checkOrder is off (container-inner / resends)', () => {
        const t = mk()
        // parity still checked, but a lower seqno is allowed (e.g. a resend container).
        expect(t.accept(id(NOW_SEC, 0), 5, { contentRelated: true, ...seq })).toEqual({ ok: true })
        expect(t.accept(id(NOW_SEC, 4), 1, { contentRelated: true, ...seq })).toEqual({ ok: true })
    })

    it('accepts correct parities', () => {
        const t = mk()
        expect(t.accept(id(NOW_SEC, 0), 1, { contentRelated: true, ...seq })).toEqual({ ok: true })
        expect(t.accept(id(NOW_SEC, 4), 2, { contentRelated: false, ...seq })).toEqual({ ok: true }) // ping (even)
        expect(t.accept(id(NOW_SEC, 8), 3, { contentRelated: true, ...seq })).toEqual({ ok: true })
    })

    it('does not enforce seqno when checkSeqNo is off (default)', () => {
        // A content-related message with an even seqno would be code 35 if checking.
        expect(mk().accept(id(NOW_SEC, 0), 2, { contentRelated: true })).toEqual({ ok: true })
    })
})

describe('InboundTracker.stateOf — msgs_state_info bytes', () => {
    it('reports a received content-related message as 4+32+64', () => {
        const t = mk()
        t.accept(id(NOW_SEC, 0), 1) // odd seqno ⇒ content-related
        expect(t.stateOf([id(NOW_SEC, 0)])).toEqual(Buffer.from([4 + 32 + 64]))
    })

    it('reports a received non-content message as 4+16 (no ack required)', () => {
        const t = mk()
        t.note(id(NOW_SEC, 0), 2) // even seqno ⇒ not content-related
        expect(t.stateOf([id(NOW_SEC, 0)])).toEqual(Buffer.from([4 + 16]))
    })

    it('reports unseen ids as 1 (too old), 2 (in range), or 3 (too high)', () => {
        const t = mk()
        t.accept(id(NOW_SEC, 100), 1) // maxReceived
        const info = t.stateOf([
            id(NOW_SEC - 400, 0), // too old by time → 1
            id(NOW_SEC, 50), // in range, not received → 2
            id(NOW_SEC, 200), // above max received → 3
        ])
        expect([...info]).toEqual([1, 2, 3])
    })

    it('returns one byte per requested id, in order', () => {
        const t = mk()
        t.accept(id(NOW_SEC, 0), 1)
        expect(t.stateOf([id(NOW_SEC, 0), id(NOW_SEC, 200)]).length).toBe(2)
    })
})
