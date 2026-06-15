import { randomBytes } from 'node:crypto'
import { noopLogger, type Logger } from '@mt-tl/tl'
import { TlReader } from '../tl/reader.js'
import { TlWriter } from '../tl/writer.js'
import type { TlCodec } from '../tl/codec.js'
import type { TlObject } from '@mt-tl/tl'
import type { Connection } from '../transport/connection.js'
import type { Storage } from '../storage/index.js'
import type { SaltService } from '../session/salts.js'
import { Handshake } from '../auth/handshake.js'
import { Dispatcher } from '../dispatch/dispatcher.js'
import { replyToBadAccept, type MessageContext, type Responder, type SendOptions } from '../dispatch/types.js'
import { ensureSession } from '../session/session-manager.js'
import { messageClass } from '../session/inbound-tracker.js'
import { igeDecrypt, igeEncrypt } from '../crypto/aes-ige.js'
import { generateMessageKey, computeMsgKey } from '../crypto/msg-key.js'
import { toBigIntLE, toBufferLE } from '../util/bytes.js'
import type { PresenceBinder } from '../updates/presence-binder.js'
import { NoopPresenceBinder } from '../updates/presence-binder.js'

export interface PipelineDeps {
    codec: TlCodec
    storage: Storage
    handshake: Handshake
    saltService: SaltService
    defaultLayer: number
    /** Presence/registry binder; defaults to a no-op (push disabled). */
    binder?: PresenceBinder
    /**
     * Disable the inbound MTProto 2.0 `msg_key` integrity check.
     *
     * ⚠️ INSECURE — leave this `false` (the default). When `false`, every inbound
     * encrypted message must carry a `msg_key` equal to the 2.0 recompute
     * `SHA256(authKey[88:120] ‖ plaintext)[8:24]`, which authenticates the
     * ciphertext (integrity + binding to the auth key). Setting it `true` makes the
     * gateway accept any ciphertext that merely decrypts to a well-formed message,
     * dropping that authentication — only enable it as a temporary interop shim for
     * non-compliant clients (e.g. ones still on the MTProto 1.0 msg_key scheme; see
     * docs/internals/msgkey-v1-quirk.md).
     */
    disableMsgKeyCheck?: boolean
    /** Disable inbound seqno validation (bad_msg codes 32/34/35); default enforced.
     *  Interop shim for clients that don't set seqno to spec. */
    disableSeqNoCheck?: boolean
    /** Observability sink; defaults to a no-op logger. */
    logger?: Logger
}

/**
 * Central message pipeline. Routes plaintext (handshake) vs encrypted packets,
 * performs MTProto 2.0 decrypt/encrypt, ensures the session, and hands decoded
 * payloads to the dispatcher. Implements {@link Responder} so the dispatcher and
 * session manager can send encrypted replies.
 */
export class MessagePipeline implements Responder {
    /** Set once after construction (the dispatcher needs this pipeline as its Responder). */
    dispatcher!: Dispatcher
    private readonly binder: PresenceBinder
    private readonly log: Logger

    constructor(private readonly deps: PipelineDeps) {
        this.binder = deps.binder ?? new NoopPresenceBinder()
        this.log = deps.logger ?? noopLogger
        // Surface the insecure interop shim ONCE at startup, not per message.
        if (deps.disableMsgKeyCheck) {
            this.log.warn('enc.msgkey.disabled', {
                insecure: true,
                hint: 'inbound ciphertext integrity not verified; see docs/internals/msgkey-v1-quirk.md',
            })
        }
    }

    async handlePacket(packet: Buffer, conn: Connection): Promise<void> {
        if (packet.length < 8) {
            conn.close()
            return
        }
        // Any inbound traffic resets a pending ping_delay_disconnect idle timer.
        conn.resetDisconnect()
        const isPlaintext = packet.readUInt32LE(0) === 0 && packet.readUInt32LE(4) === 0
        if (isPlaintext) return this.handlePlaintext(packet, conn)
        return this.handleEncrypted(packet, conn)
    }

    // --- plaintext (handshake) ---------------------------------------------

    private async handlePlaintext(packet: Buffer, conn: Connection): Promise<void> {
        // [auth_key_id=0 (8)][msg_id (8)][len (4)][body]
        if (packet.length < 20) return conn.close()
        const len = packet.readUInt32LE(16)
        if (len < 4 || packet.length < 20 + len) return conn.close()

        const reader = new TlReader(packet.subarray(20, 20 + len))
        const id = reader.readUInt32()
        if (!Handshake.isHandshakeId(id)) return

        const res = await this.deps.handshake.handle(id, reader)
        if (!res) return
        if ('raw' in res) {
            conn.send(res.raw)
            return
        }
        this.sendPlain(conn, res.reply)
    }

    private sendPlain(conn: Connection, body: TlObject): void {
        const bodyBuf = this.deps.codec.encode(body)
        const w = new TlWriter(bodyBuf.length + 24)
        w.writeLong(0n) // auth_key_id
        w.writeLong(conn.nextMessageId())
        w.writeUInt32(bodyBuf.length)
        w.writeRaw(bodyBuf)
        conn.send(w.toBuffer())
    }

    // --- encrypted ----------------------------------------------------------

    private async handleEncrypted(packet: Buffer, conn: Connection): Promise<void> {
        if (packet.length < 24) return conn.close()
        const authKeyId = toBigIntLE(packet.subarray(0, 8))
        const msgKey = packet.subarray(8, 24)
        const ciphertext = packet.subarray(24)
        if (ciphertext.length % 16 !== 0 || ciphertext.length === 0) {
            this.log.debug('enc.badlen', { authKeyId, len: ciphertext.length })
            return conn.close()
        }

        const rec = await this.deps.storage.authKeys.getById(authKeyId)
        this.log.debug('enc.key', { authKeyId, found: !!rec, blocked: rec?.isBlocked })
        if (!rec || rec.isBlocked) return conn.close()

        const { aesKey, aesIv } = generateMessageKey(rec.key, msgKey, false)
        const plain = igeDecrypt(ciphertext, aesKey, aesIv)

        // Inbound msg_key integrity (MTProto 2.0): the packet's msg_key must equal
        // SHA256(authKey[88:120] ‖ plaintext)[8:24]. This authenticates the ciphertext
        // and binds it to the auth key. Disabling the check (deps.disableMsgKeyCheck)
        // is insecure and only intended as a temporary interop shim for non-compliant
        // clients — see docs/internals/msgkey-v1-quirk.md.
        if (!this.deps.disableMsgKeyCheck) {
            if (!computeMsgKey(rec.key, plain, false).equals(msgKey)) {
                // Ciphertext failed integrity/binding — a forged or non-2.0 client.
                this.log.warn('enc.msgkey.reject', { authKeyId })
                return conn.close()
            }
        }

        const r = new TlReader(plain)
        const salt = r.readLong()
        const sessionId = r.readLong()
        const msgId = r.readLong()
        const seqNo = r.readUInt32()
        const len = r.readUInt32()
        this.log.trace('enc.ok', { authKeyId, len })
        if (len < 4 || len > plain.length) return conn.close()
        const payload = r.read(len)

        // Bind auth/session state to the connection.
        conn.ctx.authKeyId = authKeyId
        conn.ctx.authKey = rec.key
        conn.ctx.sessionId = sessionId
        if (rec.meta?.apiLayer && conn.ctx.apiLayer === this.deps.defaultLayer) {
            conn.ctx.apiLayer = rec.meta.apiLayer
        }

        // Server-salt schedule: advertise the current salt and validate the one the
        // client encrypted with. A wrong/expired salt earns a `bad_server_salt`
        // carrying the current salt — the client re-sends with it — and we drop this
        // message. See docs/internals/protocol-compliance.md.
        const { current, valid } = await this.deps.saltService.resolve(authKeyId, salt)
        conn.ctx.serverSalt = current
        if (!valid) {
            this.log.debug('salt.bad', { authKeyId })
            this.sendEncrypted(
                conn,
                {
                    _: 'bad_server_salt',
                    bad_msg_id: msgId,
                    bad_msg_seqno: seqNo,
                    error_code: 48,
                    new_server_salt: current,
                },
                { contentRelated: false },
            )
            return
        }

        // Inbound msg_id / seqno validation (https://core.telegram.org/mtproto/description):
        // a wrong/duplicate/out-of-window msg_id (or bad seqno) earns a
        // `bad_msg_notification` and the message is dropped (not dispatched, no session
        // touched). Runs after the salt gate so a salt re-send keeps its original
        // msg_id. Content-relatedness is read from the payload's constructor id. See
        // docs/internals/protocol-compliance.md.
        const seqCheck = !this.deps.disableSeqNoCheck
        const check = conn.tracker.accept(msgId, seqNo, {
            ...messageClass(payload),
            checkSeqNo: seqCheck,
            checkOrder: seqCheck,
        })
        if (!check.ok) {
            this.log.debug('msg.rejected', { authKeyId, result: check })
            replyToBadAccept(this, conn, check, msgId, seqNo)
            return
        }

        await ensureSession(
            this.deps.storage,
            this,
            conn,
            { sessionId, authKeyId, firstMsgId: msgId, subject: rec.subject ?? undefined },
            this.log,
        )

        // Register presence: by auth key (any connection — enables anonymous push)
        // and, for already-authorized keys, by subject.
        this.binder.bindAuthKey(conn, authKeyId.toString())
        if (conn.ctx.subject !== undefined) this.binder.bind(conn, conn.ctx.subject)

        const ctx: MessageContext = { msgId, seqNo, sessionId, authKeyId, salt }
        await this.dispatcher.dispatchPayload(payload, ctx, conn)
    }

    // --- Responder ----------------------------------------------------------

    sendEncrypted(conn: Connection, body: TlObject, opts: SendOptions = {}): void {
        const authKey = conn.ctx.authKey
        const authKeyId = conn.ctx.authKeyId
        if (!authKey || authKeyId === undefined) return

        const bodyBuf = this.deps.codec.encode(body, conn.ctx.apiLayer)
        const outMsgId = conn.nextMessageId(opts.isNotification)
        // Cache the answer to a request so a later duplicate of it gets a
        // `msg_detailed_info` (the request id is the `rpc_result.req_msg_id`).
        if (body._ === 'rpc_result' && typeof body.req_msg_id === 'bigint') {
            conn.tracker.recordAnswer(body.req_msg_id, outMsgId, bodyBuf.length)
        }
        const w = new TlWriter(bodyBuf.length + 32)
        w.writeLong(conn.ctx.serverSalt ?? 0n)
        w.writeLong(conn.ctx.sessionId ?? 0n)
        w.writeLong(outMsgId)
        w.writeUInt32(conn.nextSeqNo(opts.contentRelated ?? true))
        w.writeUInt32(bodyBuf.length)
        w.writeRaw(bodyBuf)
        let plain = w.toBuffer()

        // MTProto 2.0 padding: 12..1024 random bytes, total length divisible by 16.
        const minPad = 12
        const pad = minPad + ((16 - ((plain.length + minPad) % 16)) % 16)
        plain = Buffer.concat([plain, randomBytes(pad)])

        const msgKey = computeMsgKey(authKey, plain, true)
        const { aesKey, aesIv } = generateMessageKey(authKey, msgKey, true)
        const ciphertext = igeEncrypt(plain, aesKey, aesIv)
        conn.send(Buffer.concat([toBufferLE(authKeyId, 8), msgKey, ciphertext]))
    }
}
