import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { dispatchRpc } from '../src/core/index.js'
import { buildDemoApp, loadEcc, InMemoryUserRepo } from 'demo-eos-seed-app'
import { buildGateway, type Gateway } from '../src/gateway.js'
import { InProcessForwarder } from '../src/dispatch/forwarders/in-process.js'
import { TlCodec } from '../src/tl/codec.js'
import { loadSchema } from '../src/tl/registry.js'
import type { TlObject } from '@mt-tl/tl'
import { TestClient, wsTransport } from '@mt-tl/testing'

const { registry } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)
const ecc = loadEcc()
const SERVER_SEED = 'demo alpha test server seed'

let gateway: Gateway

beforeAll(async () => {
    // Real auth module (real eosjs-ecc), in-memory users, in-process forwarder.
    const app = buildDemoApp({ serverSeed: SERVER_SEED, users: new InMemoryUserRepo() })
    const forwarder = new InProcessForwarder(req => dispatchRpc(app.rpc, req, app.deps))
    gateway = await buildGateway(
        {
            nodeId: 'demo-test',
            wsPort: 0,
            defaultLayer: 204,
            schemaDir,
            schemaLayersDir: layersDir,
            storage: { backend: 'memory' },
            updates: { enabled: false, presenceTtlMs: 60_000 },
        },
        { forwarder },
    )
    await gateway.listen()
})

afterAll(async () => {
    await gateway.close()
})

describe('auth + main-screen end to end (real client + real ecc)', () => {
    it('sendCode → signUp → signIn → help.getConfig → main-screen stubs', async () => {
        // The mobile client owns an EOS key pair.
        const userPriv = ecc.seedPrivate(randomSeed())
        const userPub = ecc.privateToPublic(userPriv)

        const client = new TestClient(
            wsTransport(`ws://127.0.0.1:${gateway.wsServer!.port}`),
            gateway.publicKey,
            codec,
        )
        await client.connect()
        await client.handshake()

        // 1) sendCode → server-signed code. First call also yields new_session_created.
        const sent = await client.invoke(
            { _: 'crypto.sendCode', public_key: userPub, api_id: 1, api_hash: 'testhash' },
            2,
        )
        const sentCode = sent.find(r => r._ === 'rpc_result')!.result as TlObject
        expect(sentCode._).toBe('crypto.sentCode')
        expect(sentCode.key_registered).toBe(false) // unknown key
        const code = sentCode.code as string
        const serverSign = sentCode.server_sign as string

        // Client signs the code with its private key.
        const sign = ecc.sign(code, userPriv)

        // 2) signUp → auth.authorization with our new user; bindUser applied.
        const up = await client.invoke(
            {
                _: 'crypto.signUp',
                public_key: userPub,
                code,
                server_sign: serverSign,
                sign,
                phone_number: '',
                first_name: 'Alice',
                last_name: 'Liddell',
                email: 'alice@example.com',
                username: 'alice',
            },
            1,
        )
        const auth = up[0]!.result as TlObject
        expect(auth._).toBe('auth.authorization')
        const user = auth.user as TlObject
        expect(user._).toBe('user')
        expect(user.self).toBe(true)
        expect(user.first_name).toBe('Alice')
        expect(user.username).toBe('alice')
        expect(typeof user.id).toBe('number')
        const publicId = user.id as number // the public TL user.id (int)
        expect(publicId).toBeGreaterThan(100)
        const authKeyId = (client as unknown as { authKeyId: bigint }).authKeyId
        // The gateway binds the INTERNAL subject (a uuid string), NOT the public int id.
        const boundSubject = (await gateway.storage.authKeys.getById(authKeyId))?.subject
        expect(typeof boundSubject).toBe('string')
        expect(boundSubject).not.toBe(String(publicId))

        // 3) signIn with the same key (now registered) → same user.
        const signIn = await client.invoke(
            { _: 'crypto.signIn', public_key: userPub, code, server_sign: serverSign, sign },
            1,
        )
        const auth2 = signIn[0]!.result as TlObject
        expect(auth2._).toBe('auth.authorization')
        expect((auth2.user as TlObject).id).toBe(publicId)

        // sendCode now reports the key as registered.
        const sent2 = await client.invoke(
            { _: 'crypto.sendCode', public_key: userPub, api_id: 1, api_hash: 'testhash' },
            1,
        )
        expect((sent2[0]!.result as TlObject).key_registered).toBe(true)

        // 4) help.getConfig → a valid Config with at least one DC.
        const cfg = await client.invoke({ _: 'help.getConfig' }, 1)
        const config = cfg[0]!.result as TlObject
        expect(config._).toBe('config')
        expect((config.dc_options as unknown[]).length).toBeGreaterThanOrEqual(1)

        // help.getServerConfig → DataJSON.
        const sc = await client.invoke({ _: 'help.getServerConfig' }, 1)
        expect((sc[0]!.result as TlObject)._).toBe('dataJSON')

        // 5) Main-screen stubs (auth required, now bound).
        const state = await client.invoke({ _: 'updates.getState' }, 1)
        expect((state[0]!.result as TlObject)._).toBe('updates.state')

        const dialogs = await client.invoke(
            {
                _: 'messages.getDialogs',
                offset_date: 0,
                offset_id: 0,
                offset_peer: { _: 'inputPeerEmpty' },
                limit: 20,
                hash: 0,
            },
            1,
        )
        const dlg = dialogs[0]!.result as TlObject
        expect(dlg._).toBe('messages.dialogs')
        expect((dlg.dialogs as unknown[]).length).toBe(0)

        client.close()
    })

    it('rejects a bad client signature with PUBLIC_KEY_INVALID', async () => {
        const userPriv = ecc.seedPrivate(randomSeed())
        const userPub = ecc.privateToPublic(userPriv)
        const attackerPriv = ecc.seedPrivate(randomSeed())

        const client = new TestClient(
            wsTransport(`ws://127.0.0.1:${gateway.wsServer!.port}`),
            gateway.publicKey,
            codec,
        )
        await client.connect()
        await client.handshake()

        const sent = await client.invoke(
            { _: 'crypto.sendCode', public_key: userPub, api_id: 1, api_hash: 'h' },
            2,
        )
        const sentCode = sent.find(r => r._ === 'rpc_result')!.result as TlObject
        const code = sentCode.code as string
        // Sign with the WRONG key → recovered pubkey ≠ claimed public_key.
        const badSign = ecc.sign(code, attackerPriv)

        const res = await client.invoke(
            {
                _: 'crypto.signUp',
                public_key: userPub,
                code,
                server_sign: sentCode.server_sign as string,
                sign: badSign,
                phone_number: '',
                first_name: 'Bob',
                last_name: '',
                email: 'bob@example.com',
                username: 'bob',
            },
            1,
        )
        const err = res[0]!.result as TlObject
        expect(err._).toBe('rpc_error')
        expect(err.error_code).toBe(400)
        expect(err.error_message).toBe('PUBLIC_KEY_INVALID')
        client.close()
    })
})

function randomSeed(): string {
    return 'seed-' + Math.random().toString(36).slice(2) + Date.now()
}
