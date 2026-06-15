import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildReferenceApp } from './helpers/reference-app.js'
import { dispatchRpc, InMemoryUpdateLog } from '../src/core/index.js'
import { buildGateway, type Gateway } from '../src/gateway.js'
import { InProcessForwarder } from '../src/dispatch/forwarders/in-process.js'
import { TlCodec } from '../src/tl/codec.js'
import { loadSchema } from '../src/tl/registry.js'
import type { TlObject } from '@mt-tl/tl'
import { TestClient, wsTransport } from '@mt-tl/testing'

const { registry } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)

// Engine-owned update state: buildGateway gets a durable log + managedUpdates.
const updateLog = new InMemoryUpdateLog()
let gateway: Gateway

const newClient = () =>
    new TestClient(wsTransport(`ws://127.0.0.1:${gateway.wsServer!.port}`), gateway.publicKey, codec)
const resultOf = (replies: TlObject[]) => replies.find(r => r._ === 'rpc_result')!.result as TlObject

beforeAll(async () => {
    const app = buildReferenceApp()
    const forwarder = new InProcessForwarder(req => dispatchRpc(app.rpc, req, app.deps))
    gateway = await buildGateway(
        {
            nodeId: 'managed-updates',
            wsPort: 0,
            defaultLayer: 204,
            schemaDir,
            schemaLayersDir: layersDir,
            storage: { backend: 'memory' },
            updates: { enabled: false, presenceTtlMs: 60_000, managed: true },
        },
        { forwarder, updateLog, managedUpdates: true },
    )
    await gateway.listen()
})

afterAll(async () => {
    await gateway.close()
})

describe('protocol-managed updates.getState / getDifference', () => {
    it('rejects getState before authorization (auth gate)', async () => {
        const client = newClient()
        await client.connect()
        await client.handshake()
        const r = await client.invoke({ _: 'updates.getState' }, 2) // new_session_created + rpc_result
        const err = resultOf(r)
        expect(err._).toBe('rpc_error')
        expect(err.error_code).toBe(401)
        client.close()
    })

    it('serves state + difference from the engine pts log', async () => {
        const client = newClient()
        await client.connect()
        await client.handshake()
        // Authenticate → bindUser(5005); first message also yields new_session_created.
        await client.invoke({ _: 'account.checkFields' }, 2)

        // A server-side push appends two updates for the user (assigns pts 1, 2).
        await updateLog.append('5005', { _: 'abstract.updateBalance', wallet_id: 'w1' })
        await updateLog.append('5005', { _: 'abstract.updateBalance', wallet_id: 'w2' })

        // getState → pts 2.
        const state = resultOf(await client.invoke({ _: 'updates.getState' }, 1))
        expect(state._).toBe('updates.state')
        expect(state.pts).toBe(2)

        // getDifference{pts:0} → both updates in other_updates, state.pts 2.
        const diff = resultOf(await client.invoke({ _: 'updates.getDifference', pts: 0, date: 0, qts: 0 }, 1))
        expect(diff._).toBe('updates.difference')
        const others = diff.other_updates as TlObject[]
        expect(others.map(u => u.wallet_id)).toEqual(['w1', 'w2'])
        expect((diff.state as TlObject).pts).toBe(2)

        // getDifference{pts:2} → caught up.
        const empty = resultOf(
            await client.invoke({ _: 'updates.getDifference', pts: 2, date: 0, qts: 0 }, 1),
        )
        expect(empty._).toBe('updates.differenceEmpty')

        client.close()
    })
})
