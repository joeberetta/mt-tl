import { definePlugin } from '../framework.js'
import { requireUser } from '../hooks.js'
import type { AccountService } from '../modules/account/index.js'

/** Account routes: registration field checks + device/status stubs. */
export const accountPlugin = definePlugin<{ account: AccountService }>((app, { account }) => {
    // Registration field availability check; pre-auth (runs before sign-up).
    app.method('account.checkFields', { auth: false }, async params => {
        await account.checkFields(params)
        return true
    })

    // These act on the current user — `requireUser` asserts the auth key is bound.
    // (Push-token registration / presence are stubs: accept and return true.)
    app.method('account.registerDevice', { preHandlers: [requireUser] }, async () => true)
    app.method('account.unregisterDevice', { preHandlers: [requireUser] }, async () => true)
    app.method('account.updateStatus', { preHandlers: [requireUser] }, async () => true)
})
