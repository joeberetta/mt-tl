import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect, beforeEach } from 'vitest'
import { loadSchema } from '../src/tl/registry.js'
import { TlCodec } from '../src/tl/codec.js'
import { Dispatcher } from '../src/dispatch/dispatcher.js'
import { Connection } from '../src/transport/connection.js'
import { createMemoryStorage } from '../src/storage/memory.js'
import { SaltService } from '../src/session/salts.js'
import type { Storage } from '../src/storage/types.js'
import type { Responder, MessageContext } from '../src/dispatch/types.js'
import type { RpcForwarder, RpcRequest, RpcResponse } from '../src/dispatch/rpc-forwarder.js'
import type { TlObject } from '@mt-tl/tl'

const { registry } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)

const AUTH_KEY_ID = 999n
const ctx: MessageContext = { msgId: 1000n, seqNo: 1, sessionId: 555n, authKeyId: AUTH_KEY_ID, salt: 0n }

let storage: Storage
let captured: TlObject[]
let lastReq: RpcRequest | undefined
let scripted: RpcResponse
let conn: Connection
let dispatcher: Dispatcher

beforeEach(async () => {
    storage = createMemoryStorage()
    await storage.authKeys.create({
        id: AUTH_KEY_ID,
        key: Buffer.alloc(256),
        expiresIn: false,
        createdAt: new Date(),
        subject: null,
    })

    captured = []
    lastReq = undefined
    scripted = { result: true }

    const responder: Responder = {
        sendEncrypted(_c, body) {
            codec.encode(body) // ensure the reply is actually serializable
            captured.push(body)
        },
    }
    const forwarder: RpcForwarder = {
        async forward(req) {
            lastReq = req
            return scripted
        },
    }

    conn = new Connection(
        1,
        () => {},
        () => {},
        undefined,
        204,
    )
    conn.ctx.sessionId = ctx.sessionId
    dispatcher = new Dispatcher({
        codec,
        registry,
        storage,
        saltService: new SaltService(storage.salts),
        responder,
        forwarder,
    })
})

async function dispatch(method: TlObject): Promise<void> {
    await dispatcher.dispatchPayload(codec.encode(method), ctx, conn)
}

describe('dispatcher — forwarder envelope (effects + result)', () => {
    it('applies bindUser and returns a Bool result', async () => {
        scripted = { result: true, effects: [{ type: 'bindUser', subject: 'u-777' }] }
        await dispatch({ _: 'help.getServerConfig' })

        expect(captured).toHaveLength(1)
        expect(captured[0]!._).toBe('rpc_result')
        expect(captured[0]!.result).toBe(true)

        expect((await storage.authKeys.getById(AUTH_KEY_ID))!.subject).toBe('u-777')
        expect(conn.ctx.subject).toBe('u-777')
        expect(lastReq!.method).toBe('help.getServerConfig')
        expect(lastReq!.context.subject).toBeUndefined() // not yet bound at call time
    })

    it('serializes a tagged-object result and forwards the bound subject next time', async () => {
        scripted = { result: true, effects: [{ type: 'bindUser', subject: 'u-777' }] }
        await dispatch({ _: 'help.getServerConfig' })

        scripted = { result: { _: 'dataJSON', data: 'BTC:1.0' } }
        await dispatch({ _: 'help.getServerConfig' })

        const reply = captured[1]!
        expect(reply._).toBe('rpc_result')
        expect((reply.result as TlObject)._).toBe('dataJSON')
        expect((reply.result as TlObject).data).toBe('BTC:1.0')
        expect(lastReq!.context.subject).toBe('u-777') // bound from the first call
    })

    it('passes a backend error through as rpc_error', async () => {
        scripted = { error: { code: 420, message: 'FLOOD_WAIT_5' } }
        await dispatch({ _: 'help.getServerConfig' })

        const result = captured[0]!.result as TlObject
        expect(result._).toBe('rpc_error')
        expect(result.error_code).toBe(420)
        expect(result.error_message).toBe('FLOOD_WAIT_5')
    })

    it('unbindUser clears the user', async () => {
        scripted = { result: true, effects: [{ type: 'bindUser', subject: 'u-777' }] }
        await dispatch({ _: 'help.getServerConfig' })
        expect(conn.ctx.subject).toBe('u-777')

        scripted = { result: true, effects: [{ type: 'unbindUser' }] }
        await dispatch({ _: 'help.getServerConfig' })
        expect(conn.ctx.subject).toBeUndefined()
        expect((await storage.authKeys.getById(AUTH_KEY_ID))!.subject).toBeNull()
    })
})
