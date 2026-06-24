import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schemaDir } from 'demo-eos-seed-app/schema'
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

/** A typical `initConnection` carrying a wrapped `help.getServerConfig` query. */
function initConnection(apiId: number): TlObject {
    return {
        _: 'initConnection',
        api_id: apiId,
        device_model: 'Pixel 8',
        system_version: 'Android 14',
        app_version: '1.2.3',
        system_lang_code: 'en-US',
        lang_pack: '',
        lang_code: 'en',
        query: { _: 'help.getServerConfig' },
    }
}

let storage: Storage
let captured: TlObject[]
let lastReq: RpcRequest | undefined
let conn: Connection

function makeDispatcher(allowedApiIds?: number[]): Dispatcher {
    const responder: Responder = {
        sendEncrypted(_c, body) {
            codec.encode(body) // ensure the reply is serializable
            captured.push(body)
        },
    }
    const forwarder: RpcForwarder = {
        async forward(req): Promise<RpcResponse> {
            lastReq = req
            return { result: true }
        },
    }
    return new Dispatcher({
        codec,
        registry,
        storage,
        saltService: new SaltService(storage.salts),
        responder,
        forwarder,
        allowedApiIds,
    })
}

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
    conn = new Connection(
        1,
        () => {},
        () => {},
        undefined,
        204,
    )
    conn.ctx.authKeyId = AUTH_KEY_ID
    conn.ctx.sessionId = ctx.sessionId
})

describe('dispatcher — initConnection', () => {
    it('persists device/app fields onto the auth key meta and runs the wrapped query', async () => {
        await makeDispatcher().dispatchPayload(codec.encode(initConnection(42)), ctx, conn)

        // The wrapped query was forwarded, carrying the captured context.
        expect(lastReq?.method).toBe('help.getServerConfig')
        expect(lastReq?.context.apiId).toBe(42)
        expect(lastReq?.context.deviceModel).toBe('Pixel 8')
        expect(lastReq?.context.systemVersion).toBe('Android 14')
        expect(lastReq?.context.appVersion).toBe('1.2.3')
        expect(lastReq?.context.langCode).toBe('en')

        // Source of truth is the auth key meta, not the session.
        const meta = (await storage.authKeys.getById(AUTH_KEY_ID))!.meta
        expect(meta).toMatchObject({
            apiId: 42,
            deviceModel: 'Pixel 8',
            systemVersion: 'Android 14',
            appVersion: '1.2.3',
            systemLangCode: 'en-US',
            langCode: 'en',
        })
    })

    it('rejects an api_id outside the whitelist with API_ID_INVALID and skips the query', async () => {
        await makeDispatcher([42, 43]).dispatchPayload(codec.encode(initConnection(7)), ctx, conn)

        expect(captured).toHaveLength(1)
        const result = captured[0]!.result as TlObject
        expect(result._).toBe('rpc_error')
        expect(result.error_code).toBe(400)
        expect(result.error_message).toBe('API_ID_INVALID')

        // The wrapped query never ran, and nothing was persisted.
        expect(lastReq).toBeUndefined()
        expect((await storage.authKeys.getById(AUTH_KEY_ID))!.meta?.apiId).toBeUndefined()
    })

    it('accepts a whitelisted api_id', async () => {
        await makeDispatcher([42, 43]).dispatchPayload(codec.encode(initConnection(42)), ctx, conn)

        expect(lastReq?.method).toBe('help.getServerConfig')
        expect((await storage.authKeys.getById(AUTH_KEY_ID))!.meta?.apiId).toBe(42)
    })
})

describe('dispatcher — initConnection custom fields + onInitConnection hook', () => {
    // An overridden protocol layer that adds a custom `tenant_id` to initConnection.
    const overrideDir = mkdtempSync(join(tmpdir(), 'mt-proto-ov-'))
    writeFileSync(
        join(overrideDir, 'protocol.tl'),
        '\n---functions---\n\n' +
            'initConnection#a1b2c3d4 {X:Type} flags:# api_id:int device_model:string system_version:string app_version:string system_lang_code:string lang_pack:string lang_code:string tenant_id:flags.2?string query:!X = X;\n',
    )
    const ovRegistry = loadSchema([overrideDir, protocolSchemaDir, schemaDir]).registry
    const ovCodec = new TlCodec(ovRegistry)

    const customInit = (tenant: string): TlObject => ({ ...initConnection(42), tenant_id: tenant })

    function makeOvDispatcher(onInitConnection?: (b: TlObject) => void): Dispatcher {
        const responder: Responder = {
            sendEncrypted(_c, body) {
                ovCodec.encode(body)
                captured.push(body)
            },
        }
        const forwarder: RpcForwarder = {
            async forward(req): Promise<RpcResponse> {
                lastReq = req
                return { result: true }
            },
        }
        return new Dispatcher({
            codec: ovCodec,
            registry: ovRegistry,
            storage,
            saltService: new SaltService(storage.salts),
            responder,
            forwarder,
            onInitConnection,
        })
    }

    it('decodes a custom field → ctx.request.initParams, fires the hook, and persists it', async () => {
        let hookBody: TlObject | undefined
        await makeOvDispatcher(b => {
            hookBody = b
        }).dispatchPayload(ovCodec.encode(customInit('acme')), ctx, conn)

        // Reaches the handler context (tagged JSON; a string is unchanged)…
        expect(lastReq?.context.initParams).toMatchObject({ tenant_id: 'acme', api_id: 42 })
        // …the hook saw the full decoded body…
        expect(hookBody?.tenant_id).toBe('acme')
        // …and it's persisted on the auth key meta.
        const meta = (await storage.authKeys.getById(AUTH_KEY_ID))!.meta
        expect(meta?.initParams).toMatchObject({ tenant_id: 'acme', api_id: 42 })
    })

    it('a throwing onInitConnection rejects the connection and persists nothing', async () => {
        await makeOvDispatcher(() => {
            throw new Error('blocked')
        }).dispatchPayload(ovCodec.encode(customInit('acme')), ctx, conn)

        const result = captured[0]!.result as TlObject
        expect(result._).toBe('rpc_error')
        expect(result.error_message).toBe('INIT_CONNECTION_REJECTED')
        // The wrapped query never ran, and the hook fired BEFORE any persistence.
        expect(lastReq).toBeUndefined()
        expect((await storage.authKeys.getById(AUTH_KEY_ID))!.meta?.initParams).toBeUndefined()
    })
})
