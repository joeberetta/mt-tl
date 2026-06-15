import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildReferenceApp } from './helpers/reference-app.js'
import { dispatchRpc, PublishingUpdateEmitter, type UpdateEmitter } from '../src/core/index.js'
import { bootstrap } from '../src/bootstrap.js'
import type { Gateway, MTProtoConfig } from '../src/lib.js'
import { TlCodec } from '../src/tl/codec.js'
import { loadSchema } from '../src/tl/registry.js'
import type { TlObject } from '@mt-tl/tl'
import { TestClient, wsTransport } from '@mt-tl/testing'

const { registry } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)

const config: MTProtoConfig = {
    nodeId: 'bootstrap-e2e',
    wsPort: 0,
    defaultLayer: 204,
    schemaDir,
    schemaLayersDir: layersDir,
    storage: { backend: 'memory' },
    updates: { enabled: true, presenceTtlMs: 60_000 }, // in-memory bus/presence (no redisUrl)
}

let gateway: Gateway
let app: ReturnType<typeof buildReferenceApp>
let emitter: UpdateEmitter

beforeAll(async () => {
    // One process: gateway + the (reference) app via bootstrap's InProcessForwarder.
    gateway = await bootstrap({
        config,
        logger: undefined,
        createForward: publish => {
            emitter = new PublishingUpdateEmitter(publish)
            app = buildReferenceApp(emitter)
            return req => dispatchRpc(app.rpc, req, app.deps)
        },
    })
    await gateway.listen()
})

afterAll(async () => {
    await gateway.close()
})

describe('bootstrap: gateway + app in one process', () => {
    it('serves RPC in-process and pushes a worker-emitted update to the client', async () => {
        const client = new TestClient(
            wsTransport(`ws://127.0.0.1:${gateway.wsServer!.port}`),
            gateway.publicKey,
            codec,
        )
        await client.connect()
        await client.handshake()

        // RPC over the in-process forwarder (no broker).
        const first = await client.invoke({ _: 'help.getServerConfig' }, 2) // new_session_created + rpc_result
        const result = first.find(r => r._ === 'rpc_result')!.result as TlObject
        expect(result._).toBe('dataJSON')

        // Authenticate so presence knows where the user is.
        await client.invoke({ _: 'account.checkFields' }, 1) // bindUser(5005)

        // A server-side caller emits an update → bootstrap's bus → router → this node → client.
        await emitter.emit('5005', {
            _: 'updateShort',
            update: { _: 'abstract.updateBalance', wallet_id: 'w-1' },
            date: Math.floor(Date.now() / 1000),
        })
        const pushed = await client.receive()
        expect(pushed._).toBe('updateShort')
        expect((pushed.update as TlObject)._).toBe('abstract.updateBalance')

        client.close()
    })
})
