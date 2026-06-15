import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildGateway, type Gateway } from '../src/gateway.js'
import { loadSchema } from '../src/tl/registry.js'
import { TlCodec } from '../src/tl/codec.js'
import type { TlObject } from '@mt-tl/tl'
import { InMemoryPresence } from '../src/updates/presence.js'
import { InMemoryUpdateBus } from '../src/updates/update-bus.js'
import { UpdateRouter } from '../src/updates/router.js'
import type { RpcForwarder } from '../src/dispatch/rpc-forwarder.js'
import { TestClient, wsTransport } from '@mt-tl/testing'

const { registry } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)

const USER_ID = 'u-4242'

let gateway: Gateway
let presence: InMemoryPresence
let bus: InMemoryUpdateBus

beforeAll(async () => {
    presence = new InMemoryPresence()
    bus = new InMemoryUpdateBus()

    // Backend that authenticates any call (binds the user to the auth key).
    const forwarder: RpcForwarder = {
        async forward() {
            return { result: true, effects: [{ type: 'bindUser', subject: USER_ID }] }
        },
    }

    gateway = await buildGateway(
        {
            nodeId: 'test-node',
            wsPort: 0,
            defaultLayer: 204,
            schemaDir: schemaDir,
            schemaLayersDir: layersDir,
            storage: { backend: 'memory' },
            updates: { enabled: true, presenceTtlMs: 60_000 },
        },
        { forwarder, presence, bus },
    )
    await gateway.listen()

    // The Update Router (separate service in prod) shares the bus + presence.
    new UpdateRouter(bus, presence).start()
})

afterAll(async () => {
    await gateway.close()
    await bus.close()
})

describe('server push — worker update reaches the authenticated client', () => {
    it('routes a worker update to the live socket as an encrypted notification', async () => {
        const client = new TestClient(
            wsTransport(`ws://127.0.0.1:${gateway.wsServer!.port}`),
            gateway.publicKey,
            codec,
        )
        await client.connect()
        await client.handshake()

        // Authenticate: first encrypted message -> new_session_created + rpc_result.
        // The forwarder's bindUser effect registers presence for USER_ID on this node.
        const replies = await client.invoke({ _: 'help.getServerConfig' }, 2)
        expect(replies.map(r => r._)).toContain('new_session_created')
        expect(await presence.lookup(USER_ID)).toEqual(['test-node'])
        expect(gateway.registry.getBySubject(USER_ID)).toHaveLength(1)

        // A worker emits a balance update for the user.
        await bus.publishUpdate({
            subject: USER_ID,
            update: {
                _: 'updateShort',
                update: { _: 'abstract.updateBalance', wallet_id: 'w-123' },
                date: 1_700_000_000,
            },
        })

        const pushed = await client.receive()
        expect(pushed._).toBe('updateShort')
        const inner = pushed.update as TlObject
        expect(inner._).toBe('abstract.updateBalance')
        expect(inner.wallet_id).toBe('w-123')

        client.close()
    })

    it('deregisters presence when the connection closes', async () => {
        const client = new TestClient(
            wsTransport(`ws://127.0.0.1:${gateway.wsServer!.port}`),
            gateway.publicKey,
            codec,
        )
        await client.connect()
        await client.handshake()
        await client.invoke({ _: 'help.getServerConfig' }, 2)
        expect(await presence.lookup(USER_ID)).toContain('test-node')

        client.close()
        // allow the close event to propagate
        await new Promise(r => setTimeout(r, 100))
        expect(gateway.registry.getBySubject(USER_ID)).toHaveLength(0)
        expect(await presence.lookup(USER_ID)).toEqual([])
    })
})
