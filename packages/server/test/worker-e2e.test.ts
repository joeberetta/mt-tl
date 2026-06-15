import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildReferenceApp } from './helpers/reference-app.js'
import { dispatchRpc } from '../src/core/index.js'
import { buildGateway, type Gateway } from '../src/gateway.js'
import { InProcessForwarder } from '../src/dispatch/forwarders/in-process.js'
import { TlCodec } from '../src/tl/codec.js'
import { loadSchema } from '../src/tl/registry.js'
import type { TlObject } from '@mt-tl/tl'
import { TestClient, wsTransport } from '@mt-tl/testing'

const { registry } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)

let gateway: Gateway

beforeAll(async () => {
    // Gateway forwards business methods straight into the worker's dispatchRpc.
    const app = buildReferenceApp()
    const forwarder = new InProcessForwarder(req => dispatchRpc(app.rpc, req, app.deps))

    gateway = await buildGateway(
        {
            nodeId: 'wtest',
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

describe('gateway ↔ worker (in-process) end to end', () => {
    it('returns a real result, enforces auth gating, and applies bindUser', async () => {
        const client = new TestClient(
            wsTransport(`ws://127.0.0.1:${gateway.wsServer!.port}`),
            gateway.publicKey,
            codec,
        )
        await client.connect()
        await client.handshake()

        // 1) Read-only method → real DataJSON result (not NOT_IMPLEMENTED).
        const first = await client.invoke({ _: 'help.getServerConfig' }, 2) // new_session_created + rpc_result
        const r1 = first.find(r => r._ === 'rpc_result')!
        const data = r1.result as TlObject
        expect(data._).toBe('dataJSON')
        expect(data.data).toBe(JSON.stringify({ reference: true }))

        // 2) auth-required method before sign-in → rpc_error 401 (worker gating).
        const before = await client.invoke({ _: 'auth.logOut' }, 1)
        expect((before[0]!.result as TlObject)._).toBe('rpc_error')
        expect((before[0]!.result as TlObject).error_code).toBe(401)

        // 3) "sign in" → bindUser effect applied by the gateway.
        const signin = await client.invoke({ _: 'account.checkFields' }, 1)
        expect(signin[0]!.result).toBe(true)
        expect((await gateway.storage.authKeys.getById(authKeyIdOf(client)))?.subject).toBe('5005')

        // 4) auth-required method now succeeds (bound subject forwarded).
        const after = await client.invoke({ _: 'auth.logOut' }, 1)
        expect(after[0]!.result).toBe(true)

        client.close()
    })
})

// The client exposes its authKeyId for the storage assertion.
function authKeyIdOf(client: TestClient): bigint {
    return (client as unknown as { authKeyId: bigint }).authKeyId
}
