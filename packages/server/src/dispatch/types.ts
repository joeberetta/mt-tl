import type { Connection } from '../transport/connection.js'
import type { TlObject } from '@mt-tl/tl'
import type { AcceptResult } from '../session/inbound-tracker.js'

/** Per-message context extracted from the encrypted envelope. */
export interface MessageContext {
    msgId: bigint
    seqNo: number
    sessionId: bigint
    authKeyId: bigint
    salt: bigint
}

export interface SendOptions {
    /** Notification (msg_id ends in 3), not a direct response. */
    isNotification?: boolean
    /** Consumes a seqno slot and gets an odd seqno (default true). */
    contentRelated?: boolean
}

/** Sends an encrypted message back to a connected client. */
export interface Responder {
    sendEncrypted(conn: Connection, body: TlObject, opts?: SendOptions): void
}

/**
 * Reply to a rejected inbound message (the non-`ok` result of
 * `InboundTracker.accept`): `bad_msg_notification` for a coded violation,
 * `msg_detailed_info` for a duplicate whose answer is cached, or nothing for a
 * benign silent drop. Shared by the pipeline (outer envelope) and the dispatcher
 * (container-inner messages).
 */
export function replyToBadAccept(
    responder: Responder,
    conn: Connection,
    result: Exclude<AcceptResult, { ok: true }>,
    msgId: bigint,
    seqNo: number,
): void {
    if ('code' in result) {
        responder.sendEncrypted(
            conn,
            { _: 'bad_msg_notification', bad_msg_id: msgId, bad_msg_seqno: seqNo, error_code: result.code },
            { contentRelated: false },
        )
    } else if ('detailed' in result) {
        responder.sendEncrypted(
            conn,
            {
                _: 'msg_detailed_info',
                msg_id: msgId,
                answer_msg_id: result.detailed.answerMsgId,
                bytes: result.detailed.bytes,
                status: 0,
            },
            { contentRelated: false },
        )
    }
    // { drop: true } → no reply.
}
