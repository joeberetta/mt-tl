import { noopLogger, type Logger } from '@mt-tl/tl'
import type { Connection } from '../transport/connection.js'
import type { Storage } from '../storage/index.js'
import type { Responder } from '../dispatch/types.js'
import { randomBigInt } from '../crypto/hashes.js'

export interface SessionInfo {
    sessionId: bigint
    authKeyId: bigint
    firstMsgId: bigint
    subject?: string
}

/**
 * Ensures a persisted session exists for the connection. On the first message
 * of a new session, persists it and emits `new_session_created`. Ported from
 * the existing `handleSessionMessage`, but the session is durable (storage),
 * not an in-memory-only Map.
 */
export async function ensureSession(
    storage: Storage,
    responder: Responder,
    conn: Connection,
    info: SessionInfo,
    log: Logger = noopLogger,
): Promise<void> {
    const existing = await storage.sessions.get(info.sessionId)

    if (existing && existing.authKeyId === info.authKeyId) {
        await storage.sessions.touch(info.sessionId)
        conn.ctx.uniqueId = existing.uniqueId
        conn.ctx.apiLayer = existing.apiLayer
        conn.ctx.subject = existing.subject
        return
    }
    if (existing) await storage.sessions.delete(info.sessionId)

    const uniqueId = randomBigInt(64)
    conn.ctx.uniqueId = uniqueId
    conn.ctx.subject = info.subject

    await storage.sessions.save({
        sessionId: info.sessionId,
        authKeyId: info.authKeyId,
        uniqueId,
        apiLayer: conn.ctx.apiLayer,
        subject: info.subject,
        lastActivity: Date.now(),
    })
    log.info('session.new', {
        sessionId: info.sessionId,
        authKeyId: info.authKeyId,
        subject: info.subject,
    })

    responder.sendEncrypted(
        conn,
        {
            _: 'new_session_created',
            first_msg_id: info.firstMsgId,
            unique_id: uniqueId,
            server_salt: conn.ctx.serverSalt ?? 0n,
        },
        { isNotification: true, contentRelated: false },
    )
}
