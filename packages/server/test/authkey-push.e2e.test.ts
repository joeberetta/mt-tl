import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildReferenceApp } from './helpers/reference-app.js'
import { dispatchRpc, PublishingUpdateEmitter, type UpdateEmitter } from '../src/core/index.js'
import { buildGateway, type Gateway } from '../src/gateway.js'
import { InProcessForwarder } from '../src/dispatch/forwarders/in-process.js'
import { InMemoryUpdateBus } from '../src/updates/update-bus.js'
import { InMemoryPresence } from '../src/updates/presence.js'
import { UpdateRouter } from '../src/updates/router.js'
import { TlCodec } from '../src/tl/codec.js'
import { loadSchema } from '../src/tl/registry.js'
import type { TlObject } from '@mt-tl/tl'
import { TestClient, wsTransport } from '@mt-tl/testing'

const { registry } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)

let gateway: Gateway
let emitter: UpdateEmitter

beforeAll(async () => {
    const bus = new InMemoryUpdateBus()
    const presence = new InMemoryPresence()
    emitter = new PublishingUpdateEmitter(msg => bus.publishUpdate(msg))
    const app = buildReferenceApp(emitter)
    const forwarder = new InProcessForwarder(req => dispatchRpc(app.rpc, req, app.deps))
    gateway = await buildGateway(
        {
            nodeId: 'akpush',
            wsPort: 0,
            defaultLayer: 204,
            schemaDir,
            schemaLayersDir: layersDir,
            storage: { backend: 'memory' },
            updates: { enabled: true, presenceTtlMs: 60_000 },
        },
        { forwarder, presence, bus },
    )
    await gateway.listen()
    new UpdateRouter(bus, presence).start()
})

afterAll(async () => {
    await gateway.close()
})

describe('server push to an anonymous connection by auth key', () => {
    it('delivers an update addressed to the auth key (no login required)', async () => {
        const client = new TestClient(
            wsTransport(`ws://127.0.0.1:${gateway.wsServer!.port}`),
            gateway.publicKey,
            codec,
        )
        await client.connect()
        await client.handshake()
        // A plain ping (no login) — registers the connection by its auth key, anonymously.
        await client.invoke({ _: 'ping', ping_id: 1n }, 2) // new_session_created + pong

        // The server knows this connection only by its auth key (no bound subject).
        const authKeyId = gateway.registry.authKeys()[0]!
        expect(authKeyId).toBeDefined()
        expect(gateway.registry.subjects()).toHaveLength(0) // still anonymous

        // Push addressed to the auth key → bus → router → this node → client.
        await emitter.emitToAuthKey(authKeyId, { _: 'abstract.updateBalance', wallet_id: 'anon' })

        const pushed = (await client.receive()) as TlObject
        expect(pushed._).toBe('abstract.updateBalance')
        expect(pushed.wallet_id).toBe('anon')

        client.close()
    })
})
