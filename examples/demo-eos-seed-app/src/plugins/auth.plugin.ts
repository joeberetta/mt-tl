import { definePlugin } from '../framework.js'
import type { AuthService } from '../modules/auth/index.js'

/**
 * Auth routes: the EOS-seed register/login flow (all pre-auth). The controller is
 * thin — decode params → call the service → shape the result + `ctx.login()`.
 */
export const authPlugin = definePlugin<{ auth: AuthService }>((app, { auth }) => {
    app.method('crypto.sendCode', { auth: false }, async params => {
        const r = await auth.sendCode(params)
        return {
            _: 'crypto.sentCode',
            key_registered: r.keyRegistered,
            code: r.code,
            server_sign: r.serverSign,
        }
    })

    app.method('crypto.signIn', { auth: false }, async (params, ctx) => {
        // Bind the auth key to the INTERNAL subject (uuid); the client only ever
        // sees the public int `user.id` carried inside `auth.authorization`.
        const { subject, user } = await auth.signIn(params)
        ctx.login(subject)
        return { _: 'auth.authorization', user }
    })

    app.method('crypto.signUp', { auth: false }, async (params, ctx) => {
        const { subject, user } = await auth.signUp(params)
        ctx.login(subject)
        return { _: 'auth.authorization', user }
    })
})
