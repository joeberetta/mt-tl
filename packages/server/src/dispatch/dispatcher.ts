import { gunzipSync } from 'node:zlib'
import { TlReader } from '../tl/reader.js'
import type { TlCodec } from '../tl/codec.js'
import type { TlRegistry } from '../tl/registry.js'
import { fromJson, toJson, MigrationRegistry, type JsonValue, type TlObject, type TlValue } from '@mt-tl/tl'
import type { Connection } from '../transport/connection.js'
import type { Storage } from '../storage/index.js'
import type { SaltService } from '../session/salts.js'
import { replyToBadAccept, type MessageContext, type Responder } from './types.js'
import { messageClass } from '../session/inbound-tracker.js'
import type { RpcForwarder, RpcContext, SessionEffect } from './rpc-forwarder.js'
import type { PresenceBinder } from '../updates/presence-binder.js'
import { NoopPresenceBinder } from '../updates/presence-binder.js'
import type { UpdateLog } from '../core/updates.js'
import { noopLogger, type Logger } from '@mt-tl/tl'

const ID_GZIP_PACKED = 0x3072cfa1
const ID_MSG_CONTAINER = 0x73f1f8dc
/** Spec cap: a container carries at most 1024 messages. */
const CONTAINER_MAX_MESSAGES = 1024
/** Managed `updates.getDifference`: max updates per response before slicing. */
const DIFF_SLICE = 100
/** Managed `updates.getDifference`: gap beyond which we force a full resync (differenceTooLong). */
const DIFF_TOO_LONG = 5000
/** Methods the engine answers itself when `updates.managed` (else forwarded to the app). */
const MANAGED_UPDATES = new Set(['updates.getState', 'updates.getDifference'])

/** Protocol/service predicates handled inside the gateway (never forwarded). */
const SERVICE = new Set([
    'ping',
    'ping_delay_disconnect',
    'msgs_ack',
    'msgs_state_req',
    'msgs_all_info',
    'msg_resend_req',
    'destroy_session',
    'destroy_auth_key',
    'get_future_salts',
    'rpc_drop_answer',
    'http_wait',
])

const WRAPPERS = new Set([
    'invokeWithLayer',
    'initConnection',
    'invokeWithoutUpdates',
    'invokeAfterMsg',
    'invokeAfterMsgs',
    'invokeWithMessagesRange',
    'invokeWithTakeout',
])

export interface DispatcherDeps {
    codec: TlCodec
    registry: TlRegistry
    storage: Storage
    saltService: SaltService
    responder: Responder
    forwarder: RpcForwarder
    /** Presence/registry binder; defaults to a no-op (push disabled). */
    binder?: PresenceBinder
    /** Per-predicate migration ladders; defaults to empty (identity). */
    migrations?: MigrationRegistry
    /** Observability sink; defaults to a no-op logger. */
    logger?: Logger
    /** Disable inbound seqno validation for container-inner messages (mirrors the
     *  pipeline's `disableSeqNoCheck`); default enforced. */
    disableSeqNoCheck?: boolean
    /** Durable pts log for protocol-managed `updates.getState`/`getDifference`. */
    updateLog?: UpdateLog
    /** When true (+ `updateLog`), answer getState/getDifference in-engine. */
    managedUpdates?: boolean
    /** Whitelist of accepted `initConnection.api_id`s; omitted → any id is accepted. */
    allowedApiIds?: Iterable<number>
}

export class Dispatcher {
    private readonly binder: PresenceBinder
    private readonly migrations: MigrationRegistry
    private readonly logger: Logger
    private readonly checkSeqNo: boolean
    private readonly managedUpdates: boolean
    /** Built once from `deps.allowedApiIds`; undefined = whitelist disabled. */
    private readonly allowedApiIds?: ReadonlySet<number>

    constructor(private readonly deps: DispatcherDeps) {
        this.binder = deps.binder ?? new NoopPresenceBinder()
        this.migrations = deps.migrations ?? new MigrationRegistry()
        this.logger = deps.logger ?? noopLogger
        this.checkSeqNo = !deps.disableSeqNoCheck
        this.managedUpdates = !!deps.managedUpdates && !!deps.updateLog
        this.allowedApiIds = deps.allowedApiIds ? new Set(deps.allowedApiIds) : undefined
    }

    /** Entry point: a raw message body (after the encrypted envelope). */
    async dispatchPayload(payload: Buffer, ctx: MessageContext, conn: Connection): Promise<void> {
        if (payload.length < 4) return
        const id = payload.readUInt32LE(0)

        if (id === ID_GZIP_PACKED) {
            const r = new TlReader(payload)
            r.readUInt32()
            const inflated = gunzipSync(r.readBytes())
            return this.dispatchPayload(inflated, ctx, conn)
        }

        if (id === ID_MSG_CONTAINER) {
            // Parse the whole container before dispatching anything: a malformed one
            // (bad count / inner length overflow) is rejected atomically with
            // bad_msg_notification code 64 ("invalid container"), nothing processed.
            let inners: Array<{ msgId: bigint; seqNo: number; inner: Buffer }>
            try {
                inners = parseContainer(payload)
            } catch {
                this.logger.warn('container.invalid', {
                    authKeyId: conn.ctx.authKeyId,
                    layer: conn.ctx.apiLayer,
                    bytes: payload.length,
                })
                this.deps.responder.sendEncrypted(
                    conn,
                    {
                        _: 'bad_msg_notification',
                        bad_msg_id: ctx.msgId,
                        bad_msg_seqno: ctx.seqNo,
                        error_code: 64,
                    },
                    { contentRelated: false },
                )
                return
            }
            for (const { msgId, seqNo, inner } of inners) {
                // Validate each inner message like the outer envelope, EXCEPT ordering
                // (code 32): a resend container legitimately carries old seqnos. A bad
                // inner gets its own bad_msg_notification / msg_detailed_info and is
                // skipped; the others still run.
                const check = conn.tracker.accept(msgId, seqNo, {
                    ...messageClass(inner),
                    checkSeqNo: this.checkSeqNo,
                    checkOrder: false,
                })
                if (!check.ok) {
                    replyToBadAccept(this.deps.responder, conn, check, msgId, seqNo)
                    continue
                }
                await this.dispatchPayload(inner, { ...ctx, msgId, seqNo }, conn)
            }
            return
        }

        let body: TlObject
        try {
            body = this.deps.codec.decode(payload) as TlObject
        } catch {
            // Unknown/undecodable type — ack-by-silence, but log so it's visible.
            this.logger.warn('decode.fail', {
                id: '0x' + id.toString(16).padStart(8, '0'),
                authKeyId: conn.ctx.authKeyId,
                sessionId: conn.ctx.sessionId,
                layer: conn.ctx.apiLayer,
                bytes: payload.length,
            })
            return
        }
        await this.dispatchObject(body, ctx, conn)
    }

    private async dispatchObject(body: TlObject, ctx: MessageContext, conn: Connection): Promise<void> {
        const name = body._
        this.logger.debug('msg', {
            method: name,
            authKeyId: conn.ctx.authKeyId,
            sessionId: conn.ctx.sessionId,
            layer: conn.ctx.apiLayer,
        })

        if (WRAPPERS.has(name)) {
            if (name === 'invokeWithLayer' && typeof body.layer === 'number') {
                conn.ctx.apiLayer = body.layer
                if (conn.ctx.sessionId !== undefined) {
                    await this.deps.storage.sessions.update(conn.ctx.sessionId, { apiLayer: body.layer })
                }
            } else if (name === 'initConnection') {
                const rejected = await this.handleInitConnection(body, ctx, conn)
                if (rejected) return
            } else if (name === 'invokeWithoutUpdates') {
                // Client opts this connection out of server-push (PushService skips it).
                conn.ctx.noUpdates = true
            }
            const query = body.query
            if (query && typeof query === 'object' && '_' in query) {
                return this.dispatchObject(query as TlObject, ctx, conn)
            }
            return
        }

        if (SERVICE.has(name)) return this.handleService(body, ctx, conn)

        if (this.managedUpdates && MANAGED_UPDATES.has(name)) {
            return this.handleManagedUpdate(body, ctx, conn)
        }

        return this.forwardBusiness(body, ctx, conn)
    }

    /**
     * Process an `initConnection` envelope: optionally enforce the `api_id`
     * whitelist, then capture the device/app fields onto the connection and
     * persist them to the auth key's meta (the per-device source of truth; an
     * auth key is one app install, so this is stable per key, not per session).
     * Returns `true` when the connection was rejected (caller must not dispatch
     * the wrapped query).
     */
    private async handleInitConnection(
        body: TlObject,
        ctx: MessageContext,
        conn: Connection,
    ): Promise<boolean> {
        const apiId = typeof body.api_id === 'number' ? body.api_id : undefined
        if (this.allowedApiIds && (apiId === undefined || !this.allowedApiIds.has(apiId))) {
            this.logger.warn('initConnection.rejected', {
                authKeyId: conn.ctx.authKeyId,
                sessionId: conn.ctx.sessionId,
                apiId,
            })
            this.sendRpcError(conn, ctx.msgId, 400, 'API_ID_INVALID')
            return true
        }
        const meta = {
            apiId,
            deviceModel: asString(body.device_model),
            systemVersion: asString(body.system_version),
            appVersion: asString(body.app_version),
            systemLangCode: asString(body.system_lang_code),
            langCode: asString(body.lang_code),
        }
        conn.ctx.apiId = meta.apiId
        conn.ctx.deviceModel = meta.deviceModel
        conn.ctx.systemVersion = meta.systemVersion
        conn.ctx.appVersion = meta.appVersion
        conn.ctx.systemLangCode = meta.systemLangCode
        conn.ctx.langCode = meta.langCode
        if (conn.ctx.authKeyId !== undefined) {
            await this.deps.storage.authKeys.updateMeta(conn.ctx.authKeyId, meta)
        }
        return false
    }

    /**
     * Engine-owned `updates.getState` / `updates.getDifference` (when
     * `config.updates.managed`). Common pts sequence only — qts/seq/channels are 0.
     * Updates are returned in `other_updates`; the durable {@link UpdateLog}
     * supplies pts. Auth-gated like a normal `auth: true` method.
     */
    private async handleManagedUpdate(body: TlObject, ctx: MessageContext, conn: Connection): Promise<void> {
        const log = this.deps.updateLog!
        const subject = conn.ctx.subject
        if (subject === undefined) return this.sendRpcError(conn, ctx.msgId, 401, 'AUTH_KEY_UNREGISTERED')
        const date = Math.floor(Date.now() / 1000)
        const state = (pts: number): JsonValue => ({
            _: 'updates.state',
            pts,
            qts: 0,
            date,
            seq: 0,
            unread_count: 0,
        })

        if (body._ === 'updates.getState') {
            return this.sendRpcResult(conn, ctx.msgId, state(await log.currentPts(subject)))
        }

        // updates.getDifference
        const sincePts = Number(body.pts ?? 0)
        const current = await log.currentPts(subject)
        if (sincePts >= current) {
            return this.sendRpcResult(conn, ctx.msgId, { _: 'updates.differenceEmpty', date, seq: 0 })
        }
        if (current - sincePts > DIFF_TOO_LONG) {
            return this.sendRpcResult(conn, ctx.msgId, { _: 'updates.differenceTooLong', pts: current })
        }
        const all = await log.since(subject, sincePts)
        const sliced = all.length > DIFF_SLICE
        const page = sliced ? all.slice(0, DIFF_SLICE) : all
        const lastPts = page.at(-1)?.pts ?? current
        const common = {
            new_messages: [],
            new_encrypted_messages: [],
            other_updates: page.map(u => u.update),
            chats: [],
            users: [],
        }
        return this.sendRpcResult(
            conn,
            ctx.msgId,
            sliced
                ? { _: 'updates.differenceSlice', ...common, intermediate_state: state(lastPts) }
                : { _: 'updates.difference', ...common, state: state(lastPts) },
        )
    }

    private async handleService(body: TlObject, ctx: MessageContext, conn: Connection): Promise<void> {
        const { responder } = this.deps
        switch (body._) {
            case 'ping_delay_disconnect':
                // Close the connection after `disconnect_delay`s of inactivity unless
                // reset; then respond like a normal ping.
                conn.armDisconnect(Number(body.disconnect_delay ?? 0))
            // falls through
            case 'ping':
                responder.sendEncrypted(
                    conn,
                    { _: 'pong', msg_id: ctx.msgId, ping_id: body.ping_id as bigint },
                    { contentRelated: false },
                )
                return
            case 'msgs_state_req':
            case 'msg_resend_req': {
                // We keep no sent-message store to re-send, so per spec a msg_resend_req
                // is answered like a msgs_state_req: report each requested id's state.
                const ids = (body.msg_ids as bigint[] | undefined) ?? []
                responder.sendEncrypted(
                    conn,
                    { _: 'msgs_state_info', req_msg_id: ctx.msgId, info: conn.tracker.stateOf(ids) },
                    { contentRelated: false },
                )
                return
            }
            case 'destroy_auth_key': {
                // Permanent key destruction (logout). Block the key so any further use
                // is rejected; the response is sent before this message's key is dropped.
                await this.deps.storage.authKeys.setBlocked(ctx.authKeyId, true)
                responder.sendEncrypted(conn, { _: 'destroy_auth_key_ok' }, { contentRelated: false })
                return
            }
            case 'destroy_session': {
                // Tear down the stored session if it belongs to this auth key; the
                // client uses this to forget another session under the same key.
                const sessionId = body.session_id as bigint
                const existing = await this.deps.storage.sessions.get(sessionId)
                const owned = !!existing && existing.authKeyId === ctx.authKeyId
                if (owned) await this.deps.storage.sessions.delete(sessionId)
                responder.sendEncrypted(
                    conn,
                    { _: owned ? 'destroy_session_ok' : 'destroy_session_none', session_id: sessionId },
                    { contentRelated: false },
                )
                return
            }
            case 'get_future_salts': {
                // Return the next `num` scheduled salts (clamped) with true windows,
                // minting more if the schedule is short.
                const num = Math.min(64, Math.max(1, Number(body.num ?? 1)))
                const authKeyId = conn.ctx.authKeyId
                const scheduled =
                    authKeyId !== undefined ? await this.deps.saltService.future(authKeyId, num) : []
                responder.sendEncrypted(
                    conn,
                    {
                        _: 'future_salts',
                        req_msg_id: ctx.msgId,
                        now: Math.floor(Date.now() / 1000),
                        salts: scheduled.map(s => ({
                            _: 'future_salt',
                            valid_since: s.validSince,
                            valid_until: s.validUntil,
                            salt: s.salt,
                        })),
                    },
                    { contentRelated: false },
                )
                return
            }
            case 'rpc_drop_answer':
                // Packets are processed serially per connection (see transport `pump`)
                // and answers are sent immediately (no outgoing queue to drop from), so
                // by the time a drop arrives its target RPC has already been answered.
                // `rpc_answer_unknown` ("no memory of req_msg_id / already responded")
                // is the spec-correct reply here. The RpcDropAnswer is wrapped in an
                // rpc_result (and acknowledged) like any RPC response — see
                // docs/internals/protocol-compliance.md.
                responder.sendEncrypted(conn, {
                    _: 'rpc_result',
                    req_msg_id: ctx.msgId,
                    result: { _: 'rpc_answer_unknown' },
                })
                return
            case 'msgs_ack':
                // Client acknowledgments of server→client messages. We never retransmit,
                // so there is no resend queue for an ack to clear — nothing to do.
                return
            case 'msgs_all_info':
                // Voluntary status of our messages from the client; informational and
                // not requiring acknowledgment — nothing to do (we don't retransmit).
                return
            case 'http_wait':
            default:
                return
        }
    }

    private async forwardBusiness(body: TlObject, ctx: MessageContext, conn: Connection): Promise<void> {
        // Identity carried on every line for this request: reqId (the client's
        // msg_id) + authKeyId/sessionId/subject/layer. Matches the per-request
        // `ctx.log` child the handler layer binds, so engine ⇄ handler lines join.
        // device/ip are added only once known (deviceModel after initConnection) so
        // they don't noise pre-init lines.
        const logBase = {
            reqId: ctx.msgId,
            method: body._,
            subject: conn.ctx.subject,
            authKeyId: ctx.authKeyId,
            sessionId: ctx.sessionId,
            layer: conn.ctx.apiLayer,
            ...(conn.ctx.deviceModel ? { deviceModel: conn.ctx.deviceModel } : {}),
            ...(conn.ctx.remoteAddress ? { ip: conn.ctx.remoteAddress } : {}),
        }

        const def = this.deps.registry.getByName(body._)
        if (!def || def.kind !== 'method') {
            // Not a known business method — surface as an rpc_error.
            this.logger.warn('rpc.unknown', logBase)
            return this.sendRpcError(conn, ctx.msgId, 400, 'METHOD_NOT_FOUND')
        }

        // Normalize older-layer input up to the canonical shape before forwarding.
        const canonical = this.migrations.up(body, conn.ctx.apiLayer) as TlObject
        const params = paramsToJson(canonical, this.deps.registry)
        // Full incoming payload at debug — "what came in" (structured in JSON mode).
        this.logger.debug('rpc.params', { ...logBase, params })
        const rpcCtx: RpcContext = {
            sessionId: ctx.sessionId.toString(),
            authKeyId: ctx.authKeyId.toString(),
            subject: conn.ctx.subject,
            apiLayer: conn.ctx.apiLayer,
            apiId: conn.ctx.apiId,
            deviceModel: conn.ctx.deviceModel,
            systemVersion: conn.ctx.systemVersion,
            appVersion: conn.ctx.appVersion,
            langCode: conn.ctx.langCode,
            ip: conn.ctx.remoteAddress,
        }

        const startedAt = Date.now()
        let res
        try {
            res = await this.deps.forwarder.forward({
                id: ctx.msgId.toString(),
                method: body._,
                params,
                context: rpcCtx,
            })
        } catch (err) {
            this.logger.error('rpc.fail', { ...logBase, ms: Date.now() - startedAt, err })
            return this.sendRpcError(conn, ctx.msgId, 500, 'INTERNAL')
        }
        const ms = Date.now() - startedAt

        if (res.effects?.length) await this.applyEffects(conn, ctx, res.effects)

        if (res.error) {
            this.logger.info('rpc', {
                ...logBase,
                ms,
                status: 'error',
                code: res.error.code,
                error: res.error.message,
            })
            return this.sendRpcError(conn, ctx.msgId, res.error.code, res.error.message)
        }
        if (res.result !== undefined) {
            this.logger.info('rpc', { ...logBase, ms, status: 'ok' })
            // Full outgoing payload at debug — "what went out".
            this.logger.debug('rpc.result', { ...logBase, result: res.result })
            return this.sendRpcResult(conn, ctx.msgId, res.result)
        }
        // Neither result nor error — malformed envelope.
        this.logger.error('rpc.malformed', { ...logBase, ms })
        return this.sendRpcError(conn, ctx.msgId, 500, 'INTERNAL')
    }

    /** Apply backend-requested mutations to gateway-owned auth/session state. */
    private async applyEffects(
        conn: Connection,
        ctx: MessageContext,
        effects: SessionEffect[],
    ): Promise<void> {
        for (const effect of effects) {
            switch (effect.type) {
                case 'bindUser':
                    await this.deps.storage.authKeys.bindUser(ctx.authKeyId, effect.subject)
                    conn.ctx.subject = effect.subject
                    await this.patchSession(conn, { subject: effect.subject })
                    this.binder.bind(conn, effect.subject)
                    // A user logged in on this auth key (device login).
                    this.logger.info('user.bind', { subject: effect.subject, authKeyId: ctx.authKeyId })
                    break
                case 'unbindUser':
                    await this.deps.storage.authKeys.bindUser(ctx.authKeyId, null)
                    conn.ctx.subject = undefined
                    this.binder.unbind(conn)
                    this.logger.info('user.unbind', { authKeyId: ctx.authKeyId })
                    break
                case 'revokeKey':
                    await this.deps.storage.authKeys.setBlocked(ctx.authKeyId, true)
                    this.logger.info('authkey.revoke', { authKeyId: ctx.authKeyId })
                    break
            }
        }
    }

    private async patchSession(
        conn: Connection,
        patch: { subject?: string; apiLayer?: number },
    ): Promise<void> {
        if (conn.ctx.sessionId !== undefined) {
            await this.deps.storage.sessions.update(conn.ctx.sessionId, patch)
        }
    }

    private sendRpcResult(conn: Connection, reqMsgId: bigint, result: JsonValue): void {
        // Render the canonical result down to the client's layer before encoding.
        const tl = this.migrations.down(fromJson(result), conn.ctx.apiLayer)
        // rpc_result.result must be a boxed object, Bool, or Vector.
        if (typeof tl !== 'boolean' && !Array.isArray(tl) && !(tl && typeof tl === 'object' && '_' in tl)) {
            return this.sendRpcError(conn, reqMsgId, 500, 'INVALID_RESULT')
        }
        this.deps.responder.sendEncrypted(conn, {
            _: 'rpc_result',
            req_msg_id: reqMsgId,
            result: tl as TlObject | boolean,
        })
    }

    private sendRpcError(conn: Connection, reqMsgId: bigint, code: number, message: string): void {
        this.deps.responder.sendEncrypted(conn, {
            _: 'rpc_result',
            req_msg_id: reqMsgId,
            result: { _: 'rpc_error', error_code: code, error_message: message },
        })
    }
}

/** Build JSON-RPC params from a decoded method: drop `_` and bitmask fields. */
function paramsToJson(body: TlObject, registry: TlRegistry): JsonValue {
    const def = registry.getByName(body._)
    const omit = new Set<string>(['_'])
    if (def) {
        for (const p of def.params) {
            if (p.type.kind === 'flags') omit.add(p.name)
            else if (p.type.kind === 'flag') omit.add(p.type.flagsField)
        }
    }
    const out: Record<string, JsonValue> = {}
    for (const [k, v] of Object.entries(body)) {
        if (!omit.has(k)) out[k] = toJson(v as TlValue)
    }
    return out
}

function asString(v: unknown): string | undefined {
    return typeof v === 'string' ? v : undefined
}

/**
 * Parse a `msg_container` body into its inner messages, validating structure.
 * Throws on a malformed container (too many messages, or an inner length that
 * overruns the buffer) — the caller maps that to `bad_msg_notification` code 64.
 */
function parseContainer(payload: Buffer): Array<{ msgId: bigint; seqNo: number; inner: Buffer }> {
    const r = new TlReader(payload)
    r.readUInt32() // container constructor id
    const count = r.readUInt32()
    if (count > CONTAINER_MAX_MESSAGES) {
        throw new Error(`container: ${count} messages exceeds ${CONTAINER_MAX_MESSAGES}`)
    }
    const out: Array<{ msgId: bigint; seqNo: number; inner: Buffer }> = []
    for (let i = 0; i < count; i++) {
        const msgId = r.readLong()
        const seqNo = r.readUInt32()
        const bytes = r.readUInt32()
        const inner = r.read(bytes) // throws if `bytes` overruns the buffer
        out.push({ msgId, seqNo, inner })
    }
    return out
}
