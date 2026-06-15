import { defineHook, AuthRequiredError, NotFoundError, type HandlerCtx } from '@mt-tl/server'
import type { UserService, StoredUser } from './modules/users/index.js'

/**
 * Reusable pre-handlers (run before the handler with the same `ctx`). A hook can
 * throw to reject, or `ctx.set(...)` to pass data the handler reads via
 * `ctx.get(...)` — e.g. fetch the user once here instead of in every handler.
 */

/** Assert an authorized user; stash the subject (internal uuid) for the handler. */
export const requireUser = defineHook((_params, ctx) => {
    if (ctx.subject === undefined) throw new AuthRequiredError('AUTH_REQUIRED')
    ctx.set('subject', ctx.subject)
})

/**
 * Extend the request context with `currentUser`: load it once here so handlers
 * don't hit the DB themselves. Build it with the service in the composition root
 * (`loadCurrentUser(users)`) and attach via `preHandlers`; read it with the typed
 * `currentUser(ctx)` accessor below.
 *
 *   app.method('x', { preHandlers: [loadCurrentUser(users)] }, async (p, ctx) => {
 *       const me = currentUser(ctx)   // typed StoredUser, already fetched
 *   })
 */
export const loadCurrentUser = (users: UserService) =>
    defineHook(async (_params, ctx) => {
        if (ctx.subject === undefined) throw new AuthRequiredError('AUTH_REQUIRED')
        // The gateway bound the INTERNAL subject (uuid) — look the user up by it.
        const user = await users.bySubject(ctx.subject)
        if (!user) throw new NotFoundError('USER_NOT_FOUND')
        ctx.set('currentUser', user)
    })

/** Typed accessor for the user stashed by {@link loadCurrentUser}. */
export const currentUser = (ctx: HandlerCtx): StoredUser => ctx.get<StoredUser>('currentUser')!
