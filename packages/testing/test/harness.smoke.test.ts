import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { TlObject } from '@mt-tl/tl'
import type { RpcMethodSpec } from '@mt-tl/server'
import { createTestServer, createHarness, RpcError } from '../src/index.js'

type AnyMethods = Record<string, RpcMethodSpec>

// A self-contained proof of the high-level API, driven entirely through the
// PUBLIC `createTestServer` (no gateway internals). Inline handlers are bound to
// real demo-schema method names; the codec/push path is the production one.

const BALANCE_UPDATE = {
    _: 'updateShort',
    update: { _: 'abstract.updateBalance', wallet_id: 'w1' },
    date: 1_700_000_000,
}

let server: Awaited<ReturnType<typeof createTestServer>>

beforeAll(async () => {
    let nextSubject = 1000
    server = await createTestServer<AnyMethods>({
        schemaDir,
        schemaLayersDir: layersDir,
        register: app => {
            // Bind: log this connection in as a fresh user (presence registers on
            // the bindUser effect, i.e. once this call's rpc_result lands). Echoes
            // the connection's negotiated layer in `data` (for the layer test).
            app.method('phone.getCallConfig', { auth: false }, async (_p, ctx) => {
                ctx.login(String(++nextSubject))
                return { _: 'dataJSON', data: String(ctx.layer) }
            })
            // Push-to-self: emit an update to the caller's own subject.
            app.method('help.getServerConfig', { auth: false }, async (_p, ctx) => {
                await ctx.push(ctx.subject!, BALANCE_UPDATE)
                return { _: 'dataJSON', data: '{}' }
            })
            // Auth-required (default): used to exercise the rpc_error path pre-login.
            app.method('updates.getState', async () => ({
                _: 'updates.state',
                pts: 0,
                qts: 0,
                date: 0,
                seq: 0,
                unread_count: 0,
            }))
        },
    })
})

afterAll(async () => {
    await server.close()
})

describe('@mt-tl/testing high-level API', () => {
    it('auto-unwraps invoke to the rpc_result payload', async () => {
        const alice = await server.connect()
        const cfg = await alice.invoke('phone.getCallConfig')
        expect(cfg._).toBe('dataJSON')
        alice.close()
    })

    it('negotiates the TL layer via invokeWithLayer(initConnection)', async () => {
        // No layer → the server's defaultLayer (204, set by createTestServer).
        const def = await server.connect()
        expect((await def.invoke('phone.getCallConfig')).data).toBe('204')
        def.close()

        // Explicit layer → the handler sees ctx.layer == 185.
        const old = await server.connect({ layer: 185 })
        expect(old.negotiatedLayer).toBe(185)
        expect((await old.invoke('phone.getCallConfig')).data).toBe('185')
        old.close()
    })

    it('throws RpcError when the server replies rpc_error', async () => {
        const stranger = await server.connect()
        // updates.getState is auth:true; invoking before login → 401 rpc_error.
        await expect(stranger.invoke('updates.getState')).rejects.toBeInstanceOf(RpcError)
        try {
            await stranger.invoke('updates.getState')
        } catch (e) {
            expect((e as RpcError).code).toBe(401)
        }
        stranger.close()
    })

    it('routes server-push to the right user across multiple sessions', async () => {
        const h = createHarness(server)
        const alice = await h.user('alice')
        const bob = await h.user('bob')

        // Authenticate both (distinct user ids, presence registered).
        await alice.invoke('phone.getCallConfig')
        await bob.invoke('phone.getCallConfig')

        // Alice triggers a push addressed to herself.
        await alice.invoke('help.getServerConfig')

        const upd = await alice.expectUpdate('updateShort')
        expect((upd.update as TlObject).wallet_id).toBe('w1')

        // Bob must NOT receive Alice's update — per-user routing, not broadcast.
        await expect(bob.expectUpdate('updateShort', { timeoutMs: 300 })).rejects.toThrow()

        h.closeAll()
    })
})
