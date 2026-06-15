import { fromJson, toJson, noopLogger } from '@mt-tl/tl'
import type { Logger, RpcRequest, RpcResponse, TlValue } from '@mt-tl/tl'
import { AppError } from './errors.js'
import { createHandlerCtx, type HandlerCtx } from './context.js'
import type { UpdateEmitter } from './updates.js'

/**
 * Shape of one TL method's I/O. An app's generated `RpcMethods` (one entry per
 * method, `{ params, result }`) structurally matches `RpcMethodMap` — the
 * framework is generic over it, not bound to any specific schema.
 */
export interface RpcMethodSpec {
    params: unknown
    result: unknown
}
export type RpcMethodMap = Record<string, RpcMethodSpec>

/** A typed handler for one method `M` of the app's method map `RM`. */
export type RpcHandlerOf<RM extends Record<keyof RM, RpcMethodSpec>, M extends keyof RM> = (
    params: RM[M]['params'],
    ctx: HandlerCtx,
) => Promise<RM[M]['result']>

/**
 * A reusable pre-handler. Runs before the handler with the same `ctx`; throw an
 * `AppError` to reject (→ `rpc_error`), or `ctx.set(...)` to pass data forward.
 * Method-agnostic, so `params` is `unknown` (narrow if a hook needs them).
 */
export type Hook = (params: unknown, ctx: HandlerCtx) => Promise<void> | void

/** Identity helper for authoring a reusable hook. */
export function defineHook(fn: Hook): Hook {
    return fn
}

export type RpcEntryOf<RM extends Record<keyof RM, RpcMethodSpec>, M extends keyof RM> =
    | RpcHandlerOf<RM, M>
    | { auth?: boolean; preHandlers?: Hook[]; handler: RpcHandlerOf<RM, M> }

/** A fully-typed module of RPC handlers, keyed by the app's method names. */
export type RpcModuleOf<RM extends Record<keyof RM, RpcMethodSpec>> = { [M in keyof RM]?: RpcEntryOf<RM, M> }

// Runtime/erased shapes the registry consumes — any RpcModuleOf<RM> is assignable.
type LooseHandler = (params: never, ctx: HandlerCtx) => Promise<unknown>
type LooseEntry = LooseHandler | { auth?: boolean; preHandlers?: Hook[]; handler: LooseHandler }
/** Erased module shape — what module factories expose and the registry consumes. */
export type RpcModule = Record<string, LooseEntry | undefined>

/**
 * Creates a `defineRpc` typed against the app's generated `RpcMethods`. Use once
 * per app: `export const { defineRpc } = createRpc<RpcMethods>()`, then write
 * modules with full param/result inference per method.
 */
export function createRpc<RM extends Record<keyof RM, RpcMethodSpec>>() {
    return {
        defineRpc(mod: RpcModuleOf<RM>): RpcModuleOf<RM> {
            return mod
        },
    }
}

/** Untyped authoring helper — for fixtures/demos with no generated types. */
export function defineRpc(mod: RpcModule): RpcModule {
    return mod
}

interface Route {
    handler: (params: unknown, ctx: HandlerCtx) => Promise<unknown>
    auth: boolean
    preHandlers: Hook[]
}

/**
 * The method table behind a server. `createServer().method(...)` adds to one for
 * you; you rarely touch it directly (pass your own via `createServer(config, {
 * registry })` only for advanced wiring or tests).
 */
export class RpcRegistry {
    private routes = new Map<string, Route>()

    /** Register a module of handlers (later entries override earlier same-named ones). */
    add(mod: RpcModule): this {
        for (const [name, entry] of Object.entries(mod)) {
            if (!entry) continue
            const route: Route =
                typeof entry === 'function'
                    ? { handler: entry as Route['handler'], auth: true, preHandlers: [] }
                    : {
                          handler: entry.handler as Route['handler'],
                          auth: entry.auth ?? true,
                          preHandlers: entry.preHandlers ?? [],
                      }
            this.routes.set(name, route)
        }
        return this
    }

    get(method: string): Route | undefined {
        return this.routes.get(method)
    }

    /** Registered method names. */
    methods(): string[] {
        return [...this.routes.keys()]
    }

    get size(): number {
        return this.routes.size
    }
}

/** Process-wide dependencies {@link dispatchRpc} threads into each handler's `ctx`. */
export interface DispatchDeps {
    updates: UpdateEmitter
    /** Observability sink; a per-request child becomes `ctx.log`. Defaults to no-op. */
    logger?: Logger
}

/**
 * Routes a forwarded request to its handler and returns the gateway envelope.
 * 404 for unknown methods, 401 for auth-required methods on an anonymous key,
 * AppError → its code, anything else → 500. Effects accompany result or error.
 */
export async function dispatchRpc(
    registry: RpcRegistry,
    request: RpcRequest,
    deps: DispatchDeps,
): Promise<RpcResponse> {
    const route = registry.get(request.method)
    if (!route) return { error: { code: 404, message: 'METHOD_NOT_FOUND' } }
    if (route.auth && request.context.subject === undefined) {
        return { error: { code: 401, message: 'AUTH_KEY_UNREGISTERED' } }
    }

    // Bind the full request identity onto every handler line: reqId (the client's
    // msg_id) ties the context to one request, plus authKeyId/sessionId/subject.
    const log = (deps.logger ?? noopLogger).child({
        reqId: request.id,
        method: request.method,
        subject: request.context.subject,
        authKeyId: request.context.authKeyId,
        sessionId: request.context.sessionId,
    })
    const ctx = createHandlerCtx(request.context, deps.updates, log)
    try {
        const params = fromJson(request.params)
        for (const hook of route.preHandlers) await hook(params, ctx)
        const result = await route.handler(params, ctx)
        return { result: toJson(result as TlValue), effects: effectsOf(ctx) }
    } catch (err) {
        if (err instanceof AppError) {
            // Expected business rejection (→ rpc_error with the app's code).
            log.debug('handler.reject', { code: err.code, error: err.message })
            return { error: { code: err.code, message: err.message }, effects: effectsOf(ctx) }
        }
        // Unexpected throw — a real bug. Log it with the stack (errorStack-gated) so
        // the failed request is traceable; the client only sees a generic 500.
        log.error('handler.fail', { err })
        return { error: { code: 500, message: 'INTERNAL' }, effects: effectsOf(ctx) }
    }
}

function effectsOf(ctx: HandlerCtx) {
    return ctx.effects.length ? [...ctx.effects] : undefined
}
