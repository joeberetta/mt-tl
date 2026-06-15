import { randomBytes } from 'node:crypto'

/**
 * MTProto message-id and sequence-number generation, ported from the existing
 * server (`mtproto-tools.generateId` + `generateMessageId`/`generateMessageSeqNo`).
 *
 * A message id encodes a unix timestamp in its high bits; the low 2 bits encode
 * direction/intent: server responses end in 1, notifications in 3. Ids are kept
 * strictly increasing per connection.
 */
export interface MsgIdState {
    lastMessageId: bigint | null
    messageSeqNo: number
}

function generateId(): bigint {
    const ticks = Date.now()
    const timeSec = Math.floor(ticks / 1000)
    const timeMSec = ticks % 1000
    const random = randomBytes(2).readUInt16LE(0)
    return (BigInt(timeSec) << 32n) | BigInt((timeMSec << 21) | (random << 3) | 4)
}

export function nextMessageId(state: MsgIdState, isNotification = false): bigint {
    let id = generateId()
    if (state.lastMessageId !== null && id <= state.lastMessageId) {
        id = state.lastMessageId + 1n
    }
    const target = isNotification ? 3n : 1n
    while (id % 4n !== target) id++
    state.lastMessageId = id
    return id
}

/**
 * Sequence number for an outgoing message. Content-related messages (rpc_result,
 * updates) consume a slot and get an odd seqno; pure service messages do not.
 */
export function nextSeqNo(state: MsgIdState, contentRelated = true): number {
    const seq = state.messageSeqNo
    if (contentRelated) state.messageSeqNo++
    return seq * 2 + (contentRelated ? 1 : 0)
}
