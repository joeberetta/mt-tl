import { describe, it, expect, beforeEach } from 'vitest'
import type { RpcRequest } from '@mt-tl/tl'
import { dispatchRpc } from '@mt-tl/server'
import { buildDemoApp, loadEcc, InMemoryUserRepo, type DemoApp } from '../src/index.js'

const ecc = loadEcc()
const SERVER_SEED = 'demo unit-test seed'

// A controllable clock so CODE_EXPIRED is deterministic.
let clock = 1_000_000
let app: DemoApp
let users: InMemoryUserRepo

beforeEach(() => {
    clock = 1_000_000
    users = new InMemoryUserRepo()
    app = buildDemoApp({ serverSeed: SERVER_SEED, users, now: () => clock })
})

function call(
    method: string,
    params: Record<string, unknown>,
    subject?: string,
): ReturnType<typeof dispatchRpc> {
    const request: RpcRequest = {
        id: '1',
        method,
        params: params as RpcRequest['params'],
        context: { sessionId: 's', authKeyId: 'a', apiLayer: 204, subject },
    }
    return dispatchRpc(app.rpc, request, app.deps)
}

function newKeyPair() {
    const priv = ecc.seedPrivate(`seed-${Math.random()}-${clock}`)
    return { priv, pub: ecc.privateToPublic(priv) }
}

/** Runs sendCode then signs the returned code with `priv`. */
async function issueAndSign(pub: string, priv: string) {
    const res = await call('crypto.sendCode', { public_key: pub, api_id: 1, api_hash: 'h' })
    const sent = (res as { result: { code: string; server_sign: string; key_registered: boolean } }).result
    return {
        code: sent.code,
        serverSign: sent.server_sign,
        keyRegistered: sent.key_registered,
        sign: ecc.sign(sent.code, priv),
    }
}

describe('crypto auth', () => {
    it('sendCode reports key_registered, flipping after signUp', async () => {
        const { priv, pub } = newKeyPair()
        const first = await issueAndSign(pub, priv)
        expect(first.keyRegistered).toBe(false)

        await call('crypto.signUp', signUpParams(pub, first, 'alice'))
        const second = await issueAndSign(pub, priv)
        expect(second.keyRegistered).toBe(true)
    })

    it('signUp creates a user, emits bindUser, returns auth.authorization', async () => {
        const { priv, pub } = newKeyPair()
        const issued = await issueAndSign(pub, priv)
        const res = await call('crypto.signUp', signUpParams(pub, issued, 'alice'))

        const ok = res as {
            result: { _: string; user: { _: string; id: number; self?: true } }
            effects?: { type: string; subject?: string }[]
        }
        expect(ok.result._).toBe('auth.authorization')
        expect(ok.result.user._).toBe('user')
        expect(ok.result.user.self).toBe(true)

        // The bind effect carries the INTERNAL subject (uuid), NOT the public user.id.
        expect(ok.effects).toHaveLength(1)
        const bind = ok.effects![0]!
        expect(bind.type).toBe('bindUser')
        expect(typeof bind.subject).toBe('string')
        // …and that subject resolves to the very user whose public int id was returned —
        // the row links the two ids.
        const linked = await users.getBySubject(bind.subject!)
        expect(linked?._id).toBe(ok.result.user.id)
    })

    it('signUp rejects a duplicate username', async () => {
        const a = newKeyPair()
        await call('crypto.signUp', signUpParams(a.pub, await issueAndSign(a.pub, a.priv), 'taken'))

        const b = newKeyPair()
        // Same username, distinct email — so the username check (not email) fires.
        const res = await call('crypto.signUp', {
            ...signUpParams(b.pub, await issueAndSign(b.pub, b.priv), 'taken'),
            email: 'distinct@example.com',
        })
        expect(res).toMatchObject({ error: { code: 400, message: 'USERNAME_OCCUPIED' } })
    })

    it('signUp rejects a signature from the wrong key (PUBLIC_KEY_INVALID)', async () => {
        const { pub } = newKeyPair()
        const attacker = newKeyPair()
        const issued = await issueAndSign(pub, attacker.priv) // signed by the wrong key
        const res = await call('crypto.signUp', signUpParams(pub, issued, 'bob'))
        expect(res).toMatchObject({ error: { code: 400, message: 'PUBLIC_KEY_INVALID' } })
    })

    it('signIn fails for an unknown key, succeeds after signUp', async () => {
        const { priv, pub } = newKeyPair()
        const issued = await issueAndSign(pub, priv)

        const before = await call('crypto.signIn', {
            public_key: pub,
            code: issued.code,
            server_sign: issued.serverSign,
            sign: issued.sign,
        })
        expect(before).toMatchObject({ error: { code: 400, message: 'PUBLIC_KEY_UNOCCUPIED' } })

        await call('crypto.signUp', signUpParams(pub, issued, 'carol'))
        const after = await call('crypto.signIn', {
            public_key: pub,
            code: issued.code,
            server_sign: issued.serverSign,
            sign: issued.sign,
        })
        const ok = after as { result: { _: string }; effects?: unknown[] }
        expect(ok.result._).toBe('auth.authorization')
        expect(ok.effects).toHaveLength(1)
    })

    it('rejects an expired code', async () => {
        const { priv, pub } = newKeyPair()
        const issued = await issueAndSign(pub, priv)
        clock += 3601 // past the 1h TTL
        const res = await call('crypto.signUp', signUpParams(pub, issued, 'dave'))
        expect(res).toMatchObject({ error: { code: 400, message: 'CODE_EXPIRED' } })
    })

    it('rejects a forged server_sign (CODE_INVALID)', async () => {
        const { priv, pub } = newKeyPair()
        const issued = await issueAndSign(pub, priv)
        const res = await call('crypto.signUp', {
            ...signUpParams(pub, issued, 'eve'),
            server_sign: issued.sign, // not the server's signature
        })
        expect(res).toMatchObject({ error: { code: 400, message: 'CODE_INVALID' } })
    })
})

describe('help + main-screen', () => {
    it('help.getConfig stamps date/expires from the clock', async () => {
        const res = await call('help.getConfig', {})
        const cfg = (res as { result: { _: string; date: number; expires: number; dc_options: unknown[] } })
            .result
        expect(cfg._).toBe('config')
        expect(cfg.date).toBe(clock)
        expect(cfg.expires).toBe(clock + 3600)
        expect(cfg.dc_options.length).toBeGreaterThanOrEqual(1)
    })

    it('help.getServerConfig returns DataJSON with currentTime', async () => {
        const res = await call('help.getServerConfig', {})
        const data = JSON.parse((res as { result: { data: string } }).result.data)
        expect(data.currentTime).toBe(clock)
    })

    it('main-screen methods require auth', async () => {
        const anon = await call('updates.getState', {})
        expect(anon).toMatchObject({ error: { code: 401 } })

        const authed = await call('updates.getState', {}, 'subj-42')
        expect((authed as { result: { _: string } }).result._).toBe('updates.state')
    })
})

function signUpParams(
    pub: string,
    issued: { code: string; serverSign: string; sign: string },
    username: string,
) {
    return {
        public_key: pub,
        code: issued.code,
        server_sign: issued.serverSign,
        sign: issued.sign,
        phone_number: '',
        first_name: 'Test',
        last_name: 'User',
        email: `${username}@example.com`,
        username,
    }
}
