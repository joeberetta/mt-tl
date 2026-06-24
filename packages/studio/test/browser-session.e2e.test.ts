import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { parseSchemaDir, protocolSchemaDir } from '@mt-tl/tl'
import { createTestServer } from '@mt-tl/testing'
import type { RpcMethodSpec } from '@mt-tl/server'
import { buildRegistry, TlCodec } from '../src/client/codec.js'
import { BrowserSession, RpcError } from '../src/client/browser-session.js'
import type { ClientTransport } from '../src/client/transport.js'

// Proves the browser BrowserSession (the TestSession port) end-to-end against a
// real server: TL LAYER NEGOTIATION via invokeWithLayer, expectUpdate routing,
// and RpcError on rpc_error — the engine the multi-user scenario builder runs on.

const schemaDir = fileURLToPath(new URL('../../../examples/demo-eos-seed-app/schema', import.meta.url))

function nodeWsTransport(url: string): ClientTransport {
    let ws: WebSocket
    let onData: (chunk: Uint8Array) => void = () => {}
    let onClose: () => void = () => {}
    return {
        connect: () =>
            new Promise((resolve, reject) => {
                ws = new WebSocket(url)
                ws.binaryType = 'arraybuffer'
                ws.on('open', () => resolve())
                ws.on('error', reject)
                ws.on('message', (d: ArrayBuffer | Buffer) =>
                    onData(d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d)),
                )
                ws.on('close', () => onClose())
            }),
        send: bytes => ws.send(bytes),
        onData: cb => (onData = cb),
        onClose: cb => (onClose = cb),
        close: () => ws.close(),
    }
}

const BALANCE_UPDATE = {
    _: 'updateShort',
    update: { _: 'abstract.updateBalance', wallet_id: 'w1' },
    date: 1_700_000_000,
}

let server: Awaited<ReturnType<typeof createTestServer>>
let pem: string
let codec: TlCodec

beforeAll(async () => {
    let nextSubject = 1000
    server = await createTestServer<Record<string, RpcMethodSpec>>({
        schemaDir,
        register: app => {
            app.method('phone.getCallConfig', { auth: false }, async (_p, ctx) => {
                ctx.login(String(++nextSubject))
                return { _: 'dataJSON', data: String(ctx.layer) } // echo the negotiated layer
            })
            app.method('help.getServerConfig', { auth: false }, async (_p, ctx) => {
                await ctx.push(ctx.subject!, BALANCE_UPDATE)
                return { _: 'dataJSON', data: '{}' }
            })
            app.method('updates.getState', async () => ({ _: 'updates.state', pts: 0, qts: 0, date: 0, seq: 0, unread_count: 0 }))
        },
    })
    pem = server.publicKey.export({ type: 'spki', format: 'pem' }) as string
    codec = new TlCodec(buildRegistry([...parseSchemaDir(protocolSchemaDir).defs, ...parseSchemaDir(schemaDir).defs]))
})

afterAll(async () => {
    await server.close()
})

describe('BrowserSession ↔ real @mt-tl/server', () => {
    it('negotiates a per-session TL layer via invokeWithLayer', async () => {
        const s = await BrowserSession.fromTransport(nodeWsTransport(server.url), pem, codec, { layer: 185 })
        expect(s.negotiatedLayer).toBe(185)
        const cfg = await s.invoke('phone.getCallConfig')
        expect(cfg.data).toBe('185') // handler saw ctx.layer === 185
        s.close()
    })

    it('runs at the server default layer when none is negotiated', async () => {
        const s = await BrowserSession.fromTransport(nodeWsTransport(server.url), pem, codec)
        const cfg = await s.invoke('phone.getCallConfig')
        expect(cfg.data).toBe('204')
        s.close()
    })

    it('routes a server-pushed update to expectUpdate', async () => {
        const s = await BrowserSession.fromTransport(nodeWsTransport(server.url), pem, codec)
        await s.invoke('phone.getCallConfig') // login (sets ctx.subject)
        await s.invoke('help.getServerConfig') // pushes BALANCE_UPDATE to self
        const upd = await s.expectUpdate('updateShort')
        expect((upd.update as { wallet_id: string }).wallet_id).toBe('w1')
        s.close()
    })

    it('throws RpcError when the server replies rpc_error', async () => {
        const s = await BrowserSession.fromTransport(nodeWsTransport(server.url), pem, codec)
        await expect(s.invoke('updates.getState')).rejects.toBeInstanceOf(RpcError) // auth:true, pre-login → 401
        s.close()
    })

    it('fires onClose when the socket closes (so the studio can show honest state)', async () => {
        const s = await BrowserSession.fromTransport(nodeWsTransport(server.url), pem, codec)
        let closed = false
        s.onClose(() => {
            closed = true
        })
        s.close() // emits the same ws "close" event a server drop / network loss would
        for (let i = 0; i < 20 && !closed; i++) await new Promise(r => setTimeout(r, 50))
        expect(closed).toBe(true)
    })
})
