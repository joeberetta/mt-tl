import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { parseSchemaDir, protocolSchemaDir } from '@mt-tl/tl'
import { createTestServer } from '@mt-tl/testing'
import type { RpcMethodSpec } from '@mt-tl/server'
import { buildRegistry, TlCodec, type BObject } from '../src/client/codec.js'
import { MtprotoClient } from '../src/client/mtproto-client.js'
import type { ClientTransport } from '../src/client/transport.js'

// End-to-end proof of the WHOLE browser client (crypto + codec + handshake +
// framing) against a REAL @mt-tl/server: RSA/DH handshake, encrypted RPC, and the
// rpc_result round-trip — the same path the studio playground will run, minus the
// native WebSocket (a node `ws` transport is injected since vitest has no DOM WS).

const schemaDir = fileURLToPath(new URL('../../../examples/demo-eos-seed-app/schema', import.meta.url))
const layersDir = fileURLToPath(new URL('../../../examples/demo-eos-seed-app/schema/layers', import.meta.url))

/** A node `ws` transport that satisfies the browser ClientTransport interface. */
function nodeWsTransport(url: string): ClientTransport {
    let ws: WebSocket
    let onData: (chunk: Uint8Array) => void = () => {}
    return {
        connect: () =>
            new Promise((resolve, reject) => {
                ws = new WebSocket(url)
                ws.binaryType = 'arraybuffer'
                ws.on('open', () => resolve())
                ws.on('error', reject)
                ws.on('message', (data: ArrayBuffer | Buffer) =>
                    onData(data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data)),
                )
            }),
        send: bytes => ws.send(bytes),
        onData: cb => (onData = cb),
        close: () => ws.close(),
    }
}

let server: Awaited<ReturnType<typeof createTestServer>>

beforeAll(async () => {
    server = await createTestServer<Record<string, RpcMethodSpec>>({
        schemaDir,
        schemaLayersDir: layersDir,
        register: app => {
            // auth:false → callable WITHOUT a login (exercises the anonymous path).
            app.method('phone.getCallConfig', { auth: false }, async (_p, ctx) => ({
                _: 'dataJSON',
                data: String(ctx.layer),
            }))
        },
    })
})

afterAll(async () => {
    await server.close()
})

describe('browser MtprotoClient ↔ real @mt-tl/server', () => {
    it('handshake + unauthenticated encrypted invoke round-trips', async () => {
        const pem = server.publicKey.export({ type: 'spki', format: 'pem' }) as string
        const codec = new TlCodec(
            buildRegistry([...parseSchemaDir(protocolSchemaDir).defs, ...parseSchemaDir(schemaDir).defs]),
        )
        const client = new MtprotoClient(nodeWsTransport(server.url), pem, codec)
        await client.connect()
        await client.handshake()

        // First encrypted message → new_session_created + rpc_result (two frames).
        const replies = await client.invoke({ _: 'phone.getCallConfig' } as BObject, 2)
        expect(replies.map(r => r._)).toContain('new_session_created')

        const rpc = replies.find(r => r._ === 'rpc_result')
        expect(rpc).toBeTruthy()
        const result = rpc!.result as BObject
        expect(result._).toBe('dataJSON')
        expect(result.data).toBe('204') // server defaultLayer, echoed by the handler

        client.close()
    })
})
