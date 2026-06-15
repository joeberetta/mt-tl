import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildGateway, type Gateway } from '../src/gateway.js'
import { loadSchema } from '../src/tl/registry.js'
import { TlCodec } from '../src/tl/codec.js'
import type { TlObject } from '@mt-tl/tl'
import { TestClient, wsTransport, tcpTransport, type ClientTransport } from '@mt-tl/testing'

const { registry } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)

let gateway: Gateway

beforeAll(async () => {
    gateway = await buildGateway(
        {
            nodeId: 'test-node',
            wsPort: 0,
            tcpPort: 0,
            defaultLayer: 204,
            schemaDir: schemaDir,
            schemaLayersDir: layersDir,
            storage: { backend: 'memory' },
            updates: { enabled: false, presenceTtlMs: 60_000 },
        },
        {},
    )
    await gateway.listen()
})

afterAll(async () => {
    await gateway.close()
})

const transports: Array<[string, () => ClientTransport]> = [
    ['WebSocket', () => wsTransport(`ws://127.0.0.1:${gateway.wsServer!.port}`)],
    ['raw TCP', () => tcpTransport(gateway.tcpServer!.port)],
]

describe.each(transports)('end-to-end MTProto 2.0 over %s', (_name, makeTransport) => {
    it('handshakes, opens a session, answers ping, and returns NOT_IMPLEMENTED for a business method', async () => {
        const client = new TestClient(makeTransport(), gateway.publicKey, codec)
        await client.connect()
        await client.handshake()

        // First encrypted message: a ping. Triggers new_session_created + pong.
        const pingId = 0x1122334455667788n
        const replies = await client.invoke({ _: 'ping', ping_id: pingId }, 2)
        const names = replies.map(r => r._)
        expect(names).toContain('new_session_created')
        const pong = replies.find(r => r._ === 'pong')
        expect(pong).toBeTruthy()
        expect(pong!.ping_id).toBe(pingId)

        // A business method wrapped in invokeWithLayer -> rpc_error NOT_IMPLEMENTED.
        const businessReplies = await client.invoke(
            { _: 'invokeWithLayer', layer: 204, query: { _: 'help.getServerConfig' } },
            1,
        )
        const rpcResult = businessReplies.find(r => r._ === 'rpc_result')
        expect(rpcResult).toBeTruthy()
        const result = rpcResult!.result as TlObject
        expect(result._).toBe('rpc_error')
        expect(result.error_code).toBe(501)
        expect(result.error_message).toBe('NOT_IMPLEMENTED')

        client.close()
    })
})
