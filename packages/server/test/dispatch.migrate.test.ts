import { schemaDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect } from 'vitest'
import { MigrationRegistry, type RpcRequest, type RpcResponse } from '@mt-tl/tl'
import { loadSchema } from '../src/tl/registry.js'
import { TlCodec } from '../src/tl/codec.js'
import { Dispatcher } from '../src/dispatch/dispatcher.js'
import { Connection } from '../src/transport/connection.js'
import { createMemoryStorage } from '../src/storage/memory.js'
import { SaltService } from '../src/session/salts.js'
import type { Responder, MessageContext } from '../src/dispatch/types.js'
import type { RpcForwarder } from '../src/dispatch/rpc-forwarder.js'
import type { TlObject } from '@mt-tl/tl'

const { registry } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)
const ctx: MessageContext = { msgId: 1n, seqNo: 1, sessionId: 5n, authKeyId: 9n, salt: 0n }

function connAtLayer(layer: number): Connection {
    const c = new Connection(
        1,
        () => {},
        () => {},
        undefined,
        204,
    )
    c.ctx.apiLayer = layer
    c.ctx.sessionId = 5n
    return c
}

describe('gateway migration wiring', () => {
    it('applies `up` to inbound params before forwarding (older client → canonical)', async () => {
        const migrations = new MigrationRegistry().register('help.getServerConfig', [
            { since: 100, up: p => ({ ...p, injected: 'up' }) },
            { since: 204 },
        ])
        let forwarded: RpcRequest | undefined
        const forwarder: RpcForwarder = {
            async forward(req) {
                forwarded = req
                return { result: true }
            },
        }
        const responder: Responder = { sendEncrypted() {} }
        const dispatcher = new Dispatcher({
            codec,
            registry,
            storage: createMemoryStorage(),
            saltService: new SaltService(createMemoryStorage().salts),
            responder,
            forwarder,
            migrations,
        })

        await dispatcher.dispatchPayload(codec.encode({ _: 'help.getServerConfig' }), ctx, connAtLayer(150))
        expect((forwarded!.params as Record<string, unknown>).injected).toBe('up')
    })

    it('applies `down` to the result before encoding (canonical → older client)', async () => {
        const migrations = new MigrationRegistry().register('dataJSON', [
            { since: 100, down: c => ({ ...c, extra: 'down' }) },
            { since: 204 },
        ])
        const result: RpcResponse = { result: { _: 'dataJSON', data: 'hi' } }
        const forwarder: RpcForwarder = {
            async forward() {
                return result
            },
        }
        const sent: TlObject[] = []
        const responder: Responder = { sendEncrypted: (_c, body) => void sent.push(body) }
        const dispatcher = new Dispatcher({
            codec,
            registry,
            storage: createMemoryStorage(),
            saltService: new SaltService(createMemoryStorage().salts),
            responder,
            forwarder,
            migrations,
        })

        await dispatcher.dispatchPayload(codec.encode({ _: 'help.getServerConfig' }), ctx, connAtLayer(150))
        const rpcResult = sent.find(b => b._ === 'rpc_result')!
        const data = rpcResult.result as TlObject
        expect(data._).toBe('dataJSON')
        expect(data.extra).toBe('down')
    })
})
