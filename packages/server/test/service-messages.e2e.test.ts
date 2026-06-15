import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildGateway, type Gateway } from '../src/gateway.js'
import { loadSchema } from '../src/tl/registry.js'
import { TlCodec } from '../src/tl/codec.js'
import type { TlObject } from '@mt-tl/tl'
import { TestClient, wsTransport } from '@mt-tl/testing'

/**
 * End-to-end coverage for the gateway's MTProto service-message compliance:
 * `bad_msg_notification` (msg_id + seqno validation, invalid container),
 * `destroy_session` / `destroy_auth_key` teardown, `msgs_state_req` /
 * `msg_resend_req` state reporting, and `rpc_drop_answer`. Spec:
 * https://core.telegram.org/mtproto/service_messages and .../description.
 */

const { registry } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)

let gateway: Gateway

beforeAll(async () => {
    gateway = await buildGateway(
        {
            nodeId: 'test-service-msgs',
            wsPort: 0,
            defaultLayer: 204,
            schemaDir,
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

/** A handshaked client with an open session (the first ping creates it). */
async function connectedClient(): Promise<TestClient> {
    const client = new TestClient(
        wsTransport(`ws://127.0.0.1:${gateway.wsServer!.port}`),
        gateway.publicKey,
        codec,
    )
    await client.connect()
    await client.handshake()
    await client.invoke({ _: 'ping', ping_id: 1n }, 2) // new_session_created + pong
    return client
}

/** Send one message and return its single decoded reply. */
async function send(
    client: TestClient,
    body: TlObject,
    opts: { msgId?: bigint; seqNo?: number } = {},
): Promise<TlObject> {
    return (await client.invoke(body, 1, opts))[0]!
}

const nowSec = () => Math.floor(Date.now() / 1000)
const msgId = (sec: number, low = 4): bigint => (BigInt(sec) << 32n) | BigInt(low)

const ID_MSG_CONTAINER = 0x73f1f8dc
/** An empty `msg_container` (allowed; produces no reply). */
function emptyContainer(): Buffer {
    const b = Buffer.alloc(8)
    b.writeUInt32LE(ID_MSG_CONTAINER, 0)
    b.writeUInt32LE(0, 4) // count
    return b
}
/** A `msg_container` whose single inner message claims a body longer than present. */
function malformedContainer(): Buffer {
    const b = Buffer.alloc(24)
    b.writeUInt32LE(ID_MSG_CONTAINER, 0)
    b.writeUInt32LE(1, 4) // count
    b.writeBigUInt64LE(msgId(nowSec()), 8) // inner msg_id
    b.writeUInt32LE(0, 16) // inner seqno
    b.writeUInt32LE(0xffffffff, 20) // inner bytes — overruns the buffer
    return b
}

/** Build a well-formed `msg_container` from inner messages. */
function container(inners: Array<{ msgId: bigint; seqNo: number; body: Buffer }>): Buffer {
    const head = Buffer.alloc(8)
    head.writeUInt32LE(ID_MSG_CONTAINER, 0)
    head.writeUInt32LE(inners.length, 4)
    const parts: Buffer[] = [head]
    for (const m of inners) {
        const h = Buffer.alloc(16)
        h.writeBigUInt64LE(m.msgId, 0)
        h.writeUInt32LE(m.seqNo, 8)
        h.writeUInt32LE(m.body.length, 12)
        parts.push(h, m.body)
    }
    return Buffer.concat(parts)
}
const ping = () => codec.encode({ _: 'ping', ping_id: 1n })

describe('bad_msg_notification — msg_id validation', () => {
    it('rejects a msg_id not divisible by 4 (code 18)', async () => {
        const client = await connectedClient()
        const reply = await send(client, { _: 'ping', ping_id: 9n }, { msgId: msgId(nowSec(), 1) })
        expect(reply._).toBe('bad_msg_notification')
        expect(reply.error_code).toBe(18)
        client.close()
    })

    it('rejects a msg_id too far in the past (16) and future (17)', async () => {
        const client = await connectedClient()
        const past = await send(client, { _: 'ping', ping_id: 9n }, { msgId: msgId(nowSec() - 400) })
        expect(past.error_code).toBe(16)
        const future = await send(client, { _: 'ping', ping_id: 9n }, { msgId: msgId(nowSec() + 120) })
        expect(future.error_code).toBe(17)
        client.close()
    })

    it('rejects a duplicate CONTAINER msg_id (code 19)', async () => {
        const client = await connectedClient()
        const cid = msgId(nowSec() - 5)
        await client.invokeRaw(emptyContainer(), 0, 0, { msgId: cid }) // recorded, no reply
        const reply = (await client.invokeRaw(emptyContainer(), 2, 1, { msgId: cid }))[0]!
        expect(reply._).toBe('bad_msg_notification')
        expect(reply.error_code).toBe(19)
        client.close()
    })

    it('answers a duplicate of an already-answered request with msg_detailed_info', async () => {
        const client = await connectedClient()
        const dup = msgId(nowSec() - 5)
        const first = await send(client, { _: 'help.getServerConfig' }, { msgId: dup }) // rpc_result, cached
        expect(first._).toBe('rpc_result')
        const again = await send(client, { _: 'help.getServerConfig' }, { msgId: dup })
        expect(again._).toBe('msg_detailed_info')
        expect(again.msg_id).toBe(dup)
        expect(again.answer_msg_id).toBeTruthy()
        client.close()
    })

    it('silently drops a duplicate with no cached answer (connection survives)', async () => {
        const client = await connectedClient()
        const dup = msgId(nowSec() - 6)
        await send(client, { _: 'ping', ping_id: 1n }, { msgId: dup }) // pong (not an rpc_result → not cached)
        await client.invoke({ _: 'ping', ping_id: 1n }, 0, { msgId: dup }) // duplicate → dropped, no reply
        // A fresh message still gets its own (and only its own) reply.
        const next = await send(client, { _: 'ping', ping_id: 42n })
        expect(next._).toBe('pong')
        client.close()
    })

    it('rejects an invalid container (code 64)', async () => {
        const client = await connectedClient()
        const reply = (await client.invokeRaw(malformedContainer(), 0, 1, { msgId: msgId(nowSec()) }))[0]!
        expect(reply._).toBe('bad_msg_notification')
        expect(reply.error_code).toBe(64)
        client.close()
    })
})

describe('bad_msg_notification — seqno validation', () => {
    it('rejects a content-related message with an even seqno (code 35)', async () => {
        const client = await connectedClient()
        const reply = await send(client, { _: 'help.getServerConfig' }, { seqNo: 2 })
        expect(reply._).toBe('bad_msg_notification')
        expect(reply.error_code).toBe(35)
        client.close()
    })

    it('rejects a pure-service message with an odd seqno (code 34)', async () => {
        const client = await connectedClient()
        const reply = await send(client, { _: 'ping', ping_id: 9n }, { seqNo: 3 })
        expect(reply._).toBe('bad_msg_notification')
        expect(reply.error_code).toBe(34)
        client.close()
    })
})

describe('destroy_session', () => {
    it('tears down the current session (destroy_session_ok)', async () => {
        const client = await connectedClient()
        expect(await gateway.storage.sessions.get(client.session)).toBeTruthy()
        const reply = await send(client, { _: 'destroy_session', session_id: client.session })
        expect(reply._).toBe('destroy_session_ok')
        expect(await gateway.storage.sessions.get(client.session)).toBeNull()
        client.close()
    })

    it('returns destroy_session_none for an unknown session', async () => {
        const client = await connectedClient()
        const reply = await send(client, { _: 'destroy_session', session_id: 0xdead_beef_dead_beefn })
        expect(reply._).toBe('destroy_session_none')
        client.close()
    })
})

describe('destroy_auth_key', () => {
    it('blocks the auth key and replies destroy_auth_key_ok', async () => {
        const client = await connectedClient()
        const reply = await send(client, { _: 'destroy_auth_key' })
        expect(reply._).toBe('destroy_auth_key_ok')
        const rec = await gateway.storage.authKeys.getById(client.authKey_id)
        expect(rec?.isBlocked).toBe(true)
        client.close()
    })
})

describe('msgs_state_req / msg_resend_req', () => {
    it('reports received / unknown message states per id', async () => {
        const client = await connectedClient()
        const known = msgId(nowSec() - 5)
        await send(client, { _: 'help.getServerConfig' }, { msgId: known }) // content, recorded

        const reply = await send(client, {
            _: 'msgs_state_req',
            msg_ids: [known, msgId(nowSec() + 600), msgId(nowSec() - 600)],
        })
        expect(reply._).toBe('msgs_state_info')
        const info = reply.info as string
        expect(info.charCodeAt(0)).toBe(4 + 32 + 64) // received content message
        expect(info.charCodeAt(1)).toBe(3) // too high
        expect(info.charCodeAt(2)).toBe(1) // too old
        client.close()
    })

    it('answers msg_resend_req with msgs_state_info (we keep no resend store)', async () => {
        const client = await connectedClient()
        const known = msgId(nowSec() - 5)
        await send(client, { _: 'help.getServerConfig' }, { msgId: known })
        const reply = await send(client, { _: 'msg_resend_req', msg_ids: [known] })
        expect(reply._).toBe('msgs_state_info')
        expect((reply.info as string).charCodeAt(0)).toBe(4 + 32 + 64)
        client.close()
    })
})

describe('container-inner message validation', () => {
    it('dispatches a valid inner message (pong)', async () => {
        const client = await connectedClient()
        const c = container([{ msgId: msgId(nowSec() - 1), seqNo: 0, body: ping() }])
        const reply = (await client.invokeRaw(c, 0, 1, { msgId: msgId(nowSec()) }))[0]!
        expect(reply._).toBe('pong')
        client.close()
    })

    it('rejects a bad inner msg_id (code 18) targeting the inner id', async () => {
        const client = await connectedClient()
        const badInner = msgId(nowSec(), 1) // not divisible by 4
        const c = container([{ msgId: badInner, seqNo: 0, body: ping() }])
        const reply = (await client.invokeRaw(c, 0, 1, { msgId: msgId(nowSec()) }))[0]!
        expect(reply._).toBe('bad_msg_notification')
        expect(reply.error_code).toBe(18)
        expect(reply.bad_msg_id).toBe(badInner)
        client.close()
    })
})

describe('rpc_drop_answer', () => {
    it('returns rpc_answer_unknown wrapped in rpc_result (answers are sent immediately)', async () => {
        const client = await connectedClient()
        const reply = await send(client, { _: 'rpc_drop_answer', req_msg_id: msgId(nowSec() - 1) })
        expect(reply._).toBe('rpc_result')
        expect((reply.result as TlObject)._).toBe('rpc_answer_unknown')
        client.close()
    })
})
