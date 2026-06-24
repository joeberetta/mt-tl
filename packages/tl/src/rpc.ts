import type { JsonValue } from './tl/value.js'

/** Per-request connection context the engine attaches to every business call; surfaced as `ctx.request`. */
export interface RpcContext {
    /** The MTProto session id (hex). */
    sessionId: string
    /** The connection's auth key id (hex). */
    authKeyId: string
    /**
     * The **subject** bound to this auth key — your app's *internal* user id,
     * opaque to the framework and safe to share across your services (e.g. a
     * uuid). Set it via `ctx.login(subject)`; `undefined` for an anonymous key.
     *
     * This is deliberately NOT the wire `user_id` your TL schema exposes to
     * clients (Telegram-style `int`/`long`). The framework only routes/persists
     * by `subject`; mapping `subject ⇄ public user_id` is your app's job (see the
     * demo's `users` module). Keeping them separate lets the public id stay an
     * `int` while the protocol runs entirely on your internal id.
     */
    subject?: string
    /** The client's negotiated TL layer. */
    apiLayer: number
    /** `initConnection.api_id` — the client app id, if reported. */
    apiId?: number
    /** `initConnection.device_model`, if reported. */
    deviceModel?: string
    /** `initConnection.system_version`, if reported. */
    systemVersion?: string
    /** `initConnection.app_version`, if reported. */
    appVersion?: string
    /** `initConnection.lang_code`, if reported. */
    langCode?: string
    /**
     * The FULL `initConnection` fields (minus `_`/`query`) as tagged JSON (same
     * convention as {@link RpcRequest.params}), if the client sent one. The escape
     * hatch for CUSTOM fields added by an overridden protocol schema —
     * `apiId`/`deviceModel`/… above are just the standard ones pre-extracted. Also
     * persisted to the auth key's meta.
     */
    initParams?: Record<string, unknown>
    /** Client IP (from the carrier / `X-Forwarded-For`), if known. */
    ip?: string
}

/** A decoded business method call handed to the handler layer. */
export interface RpcRequest {
    /** Derived from the client's reqMsgId. */
    id: string
    /** TL method name, e.g. "dust.getConfig". */
    method: string
    /** Decoded params as tagged JSON (bigint -> {$bigint}, Buffer -> {$bin}). */
    params: JsonValue
    /** The connection context (see {@link RpcContext}). */
    context: RpcContext
}

/**
 * A side-effect a handler records (via `ctx.login`/`logout`/`revoke`) for the
 * engine to apply to auth-key state, returned alongside the normal result/error.
 * Keeps the engine agnostic to your auth scheme: a `signIn` handler returns
 * `bindUser`, and the engine binds the `subject` (your internal user id) to the
 * auth key.
 */
export type SessionEffect =
    | { type: 'bindUser'; subject: string }
    | { type: 'unbindUser' }
    | { type: 'revokeKey' }

/**
 * Response envelope (transport-agnostic). Exactly one of `result` / `error` is
 * set; `effects` may accompany either.
 */
export interface RpcResponse {
    /** A TL result as tagged JSON ({ _: name, ... }, $bigint/$bin), or a primitive. */
    result?: JsonValue
    error?: { code: number; message: string }
    effects?: SessionEffect[]
}
