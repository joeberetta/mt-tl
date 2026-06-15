import { noopLogger, type Logger, type RpcContext, type SessionEffect } from '@mt-tl/tl'
import type { UpdateEmitter } from './updates.js'

/**
 * Handler-facing context: the request data plus session effects, server-push,
 * and a per-request value bag. Business dependencies are NOT here — a handler
 * (or a plugin) closes over its service (Style A DI), so `ctx` carries only
 * request-scoped + cross-cutting concerns. Handlers stay thin: call the service,
 * shape the result, optionally `login()`/`push()`.
 */
export interface HandlerCtx {
    /** Raw request context forwarded by the gateway (sessionId, authKeyId, ip, …). */
    readonly request: RpcContext
    /** The bound **subject** — your app's internal user id (opaque string, e.g. a
     * uuid), shareable across your services. `undefined` if the auth key is
     * anonymous; on an `auth: true` method it is guaranteed present, so
     * `ctx.subject!` is safe there. Distinct from any wire `user_id:int` your TL
     * schema exposes — map between them in your app (see the demo `users` module). */
    readonly subject: string | undefined
    /** The TL layer this request came in on (the client's negotiated layer).
     * Read-only — layer negotiation is the protocol's job. Branch on it when an
     * old client needs a different response shape. */
    readonly layer: number
    /** Per-request logger (a child bound with method/subject) — log with the same
     * style as the framework so app and engine lines interleave coherently. */
    readonly log: Logger
    /** Low-level update emitter behind {@link push}; prefer `ctx.push(subject, update)`. */
    readonly updates: UpdateEmitter
    /** Collected session effects (applied by the gateway). */
    readonly effects: readonly SessionEffect[]

    // ── session effects ──────────────────────────────────────────────────────
    /** Bind the auth key to a `subject` — your internal user id (device login). */
    login(subject: string): void
    /** Unbind the auth key (logout). */
    logout(): void
    /** Revoke the auth key entirely. */
    revoke(): void

    // ── server push ──────────────────────────────────────────────────────────
    /** Push a TL update to a `subject` (delivered via the update bus to whatever node holds them). */
    push(subject: string, update: unknown): Promise<void>
    /**
     * Push to a specific auth key — including an anonymous (not-logged-in)
     * connection, e.g. to deliver API to a client before it registers. Pass
     * `ctx.request.authKeyId` for the current connection. No pts (anonymous
     * connections have no durable update state).
     */
    pushToAuthKey(authKeyId: string, update: unknown): Promise<void>

    // ── per-request value bag (pre-handler → handler) ─────────────────────────
    /** Stash a value for the handler (e.g. data a pre-handler already fetched). */
    set(key: string, value: unknown): void
    /** Read a value stashed earlier in this request. */
    get<T = unknown>(key: string): T | undefined

    // ── deprecated aliases (use login/logout/revoke) ──────────────────────────
    /** @deprecated use {@link login} */
    bindUser(subject: string): void
    /** @deprecated use {@link logout} */
    unbindUser(): void
    /** @deprecated use {@link revoke} */
    revokeKey(): void
}

export function createHandlerCtx(
    request: RpcContext,
    updates: UpdateEmitter,
    log: Logger = noopLogger,
): HandlerCtx {
    const effects: SessionEffect[] = []
    const bag = new Map<string, unknown>()
    const login = (subject: string) => void effects.push({ type: 'bindUser', subject })
    const logout = () => void effects.push({ type: 'unbindUser' })
    const revoke = () => void effects.push({ type: 'revokeKey' })
    return {
        request,
        subject: request.subject,
        layer: request.apiLayer,
        log,
        updates,
        effects,
        login,
        logout,
        revoke,
        push: (subject, update) => updates.emit(subject, update as never),
        pushToAuthKey: (authKeyId, update) => updates.emitToAuthKey(authKeyId, update as never),
        set: (key, value) => void bag.set(key, value),
        get: <T>(key: string) => bag.get(key) as T | undefined,
        bindUser: login,
        unbindUser: logout,
        revokeKey: revoke,
    }
}
