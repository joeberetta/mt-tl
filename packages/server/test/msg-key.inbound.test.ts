import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { buildGateway, type Gateway } from '../src/gateway.js'
import { loadSchema } from '../src/tl/registry.js'
import { TlCodec } from '../src/tl/codec.js'
import { TlWriter } from '../src/tl/writer.js'
import { Connection } from '../src/transport/connection.js'
import { SaltService } from '../src/session/salts.js'
import { igeEncrypt } from '../src/crypto/aes-ige.js'
import { generateMessageKey, computeMsgKey } from '../src/crypto/msg-key.js'
import { sha1 } from '../src/crypto/hashes.js'
import { toBufferLE } from '../src/util/bytes.js'
import type { RpcForwarder, RpcRequest, RpcResponse } from '../src/dispatch/rpc-forwarder.js'
import type { TlObject } from '@mt-tl/tl'

/**
 * Inbound MTProto 2.0 msg_key integrity check + the `disableMsgKeyCheck` escape hatch.
 *
 * With the check ENABLED (the default), an inbound packet whose msg_key is not the
 * 2.0 recompute `computeMsgKey(authKey, plaintext, false)` is rejected (conn.close).
 * With the check DISABLED, such a packet is decrypted and dispatched anyway — the
 * insecure interop shim for non-compliant clients (e.g. ones still computing msg_key
 * the MTProto 1.0 way: SHA1 of the unpadded plaintext). See
 * docs/internals/msgkey-v1-quirk.md.
 *
 * Note the e2e `TestClient` is symmetric (signs with the same v2 computeMsgKey the
 * gateway verifies with), so it can't exercise the mismatch path — this test signs
 * inbound packets manually to do so.
 */

const { registry } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)

const AUTH_KEY_ID = 0x0102030405060708n
const SESSION_ID = 0x1111222233334444n
// Current-time msg_id (high 32 bits = unix seconds, divisible by 4) so the inbound
// msg_id window check accepts it — this test exercises msg_key, not msg_id validation.
const MSG_ID = (BigInt(Math.floor(Date.now() / 1000)) << 32n) | 4n

// Deterministic 256-byte auth key (content is irrelevant to the test).
const authKey = Buffer.alloc(256)
for (let i = 0; i < 256; i++) authKey[i] = (i * 7 + 3) & 0xff

/** msg_key scheme used to sign an inbound packet: 2.0 (compliant) or 1.0 SHA1-unpadded. */
type Scheme = 'v2' | 'legacy-v1'

/** Build a client->server encrypted packet, signing msg_key with the given scheme. */
function buildInboundPacket(
    method: TlObject,
    scheme: Scheme,
): { packet: Buffer; plain: Buffer; msgKey: Buffer } {
    const body = codec.encode(method)
    const w = new TlWriter(body.length + 32)
    w.writeLong(0n) // salt
    w.writeLong(SESSION_ID) // session_id
    w.writeLong(MSG_ID) // msg_id
    w.writeUInt32(1) // seq_no
    w.writeUInt32(body.length) // length
    w.writeRaw(body)
    const unpadded = w.toBuffer() // header(32) + payload, no padding yet

    // MTProto 2.0 padding: 12..1024 random bytes, total length divisible by 16.
    const minPad = 12
    const pad = minPad + ((16 - ((unpadded.length + minPad) % 16)) % 16)
    const plain = Buffer.concat([unpadded, randomBytes(pad)])

    // v2 = SHA256(authKey[88:120] ‖ plain)[8:24]; legacy-v1 = SHA1(unpadded)[4:20].
    const msgKey = scheme === 'v2' ? computeMsgKey(authKey, plain, false) : sha1(unpadded).subarray(4, 20)

    // The AES key is always derived the 2.0 way from whatever msg_key we send, so the
    // packet decrypts regardless of how msg_key was computed.
    const { aesKey, aesIv } = generateMessageKey(authKey, msgKey, false)
    const ciphertext = igeEncrypt(plain, aesKey, aesIv)
    const packet = Buffer.concat([toBufferLE(AUTH_KEY_ID, 8), msgKey, ciphertext])
    return { packet, plain, msgKey }
}

let gateway: Gateway | undefined

async function setup(disableMsgKeyCheck: boolean): Promise<{
    gateway: Gateway
    conn: Connection
    forwarded: RpcRequest[]
}> {
    const forwarded: RpcRequest[] = []
    const forwarder: RpcForwarder = {
        async forward(req: RpcRequest): Promise<RpcResponse> {
            forwarded.push(req)
            return { result: true }
        },
    }
    gateway = await buildGateway(
        {
            nodeId: 'test-msgkey',
            // No carriers — we drive the pipeline directly, no sockets needed.
            defaultLayer: 204,
            schemaDir,
            schemaLayersDir: layersDir,
            storage: { backend: 'memory' },
            updates: { enabled: false, presenceTtlMs: 60_000 },
            disableMsgKeyCheck,
        },
        { forwarder },
    )
    await gateway.storage.authKeys.create({
        id: AUTH_KEY_ID,
        key: authKey,
        expiresIn: false,
        createdAt: new Date(),
        subject: null,
    })
    // The handshake normally seeds the salt schedule; these packets are built by
    // hand (salt 0n), so seed a matching window or the salt gate would reject them.
    await new SaltService(gateway.storage.salts).seed(AUTH_KEY_ID, 0n)
    const conn = new Connection(
        1,
        () => {},
        () => {},
        undefined,
        204,
    )
    return { gateway, conn, forwarded }
}

afterEach(async () => {
    await gateway?.close()
    gateway = undefined
})

describe('inbound msg_key check (enabled by default)', () => {
    it('dispatches a correctly v2-signed message', async () => {
        const { gateway, conn, forwarded } = await setup(false)
        const { packet, plain, msgKey } = buildInboundPacket({ _: 'help.getServerConfig' }, 'v2')
        expect(computeMsgKey(authKey, plain, false).equals(msgKey)).toBe(true)

        await gateway.pipeline.handlePacket(packet, conn)

        expect(conn.closed).toBe(false)
        expect(forwarded.map(r => r.method)).toContain('help.getServerConfig')
    })

    it('rejects (closes) a message whose msg_key is not the v2 recompute', async () => {
        const { gateway, conn, forwarded } = await setup(false)
        const { packet, plain, msgKey } = buildInboundPacket({ _: 'help.getServerConfig' }, 'legacy-v1')
        // Precondition: this is exactly the mismatch path — v2 recompute differs.
        expect(computeMsgKey(authKey, plain, false).equals(msgKey)).toBe(false)

        await gateway.pipeline.handlePacket(packet, conn)

        expect(conn.closed).toBe(true)
        expect(forwarded).toHaveLength(0)
    })
})

describe('inbound msg_key check disabled (insecure interop shim)', () => {
    it('decrypts and dispatches a non-v2 (legacy SHA1) message instead of dropping it', async () => {
        const { gateway, conn, forwarded } = await setup(true)
        const { packet, plain, msgKey } = buildInboundPacket({ _: 'help.getServerConfig' }, 'legacy-v1')
        expect(computeMsgKey(authKey, plain, false).equals(msgKey)).toBe(false)

        await gateway.pipeline.handlePacket(packet, conn)

        expect(conn.closed).toBe(false)
        expect(forwarded.map(r => r.method)).toContain('help.getServerConfig')
    })
})
