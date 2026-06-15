import { RpcRegistry, type DispatchDeps, type UpdateEmitter } from '../../src/core/index.js'

const noopEmitter: UpdateEmitter = { async emit() {}, async emitToAuthKey() {} }

export interface ReferenceApp {
    rpc: RpcRegistry
    deps: DispatchDeps
}

/**
 * A tiny in-memory app used by the engine's end-to-end tests: one read-only
 * method plus a bind/unbind pair, enough to exercise the RPC envelope, session
 * effects, and the auth gate against a real client. Built with the public
 * registry API — no events/jobs machinery.
 */
export function buildReferenceApp(updates: UpdateEmitter = noopEmitter): ReferenceApp {
    const config = JSON.stringify({ reference: true })
    const rpc = new RpcRegistry().add({
        // Read-only: returns a config blob.
        'help.getServerConfig': { auth: false, handler: async () => ({ _: 'dataJSON', data: config }) },
        // Stands in for sign-in: authorizes the auth key (bindUser effect).
        'account.checkFields': {
            auth: false,
            handler: async (_params, ctx) => {
                ctx.login('5005')
                return true
            },
        },
        // Requires auth; clears the binding (unbindUser effect).
        'auth.logOut': {
            auth: true,
            handler: async (_params, ctx) => {
                ctx.logout()
                return true
            },
        },
    })
    return { rpc, deps: { updates } }
}
