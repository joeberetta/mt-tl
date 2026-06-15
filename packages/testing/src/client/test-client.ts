import { randomBytes, type KeyObject } from 'node:crypto'
import type { TlObject } from '@mt-tl/tl'
import {
    TlReader,
    TlWriter,
    type TlCodec,
    igeEncrypt,
    igeDecrypt,
    sha1,
    generateMessageKey,
    computeMsgKey,
    modPow,
    rsaEncryptNoPadding,
    toBigIntBE,
    toBigIntLE,
    toBufferBE,
    toBufferLE,
    xorBuffers,
} from '@mt-tl/server/testkit'
import type { ClientTransport } from './transport.js'

/** Overrides for a single encrypted send. `salt` exercises `bad_server_salt`;
 *  `msgId`/`seqNo` exercise `bad_msg_notification`. */
export interface SendOpts {
    salt?: bigint
    msgId?: bigint
    seqNo?: number
}

// --- minimal MTProto 2.0 client (intermediate framing) ---------------------

/**
 * A protocol-correct MTProto 2.0 client: full RSA/DH handshake, AES-IGE +
 * msg_key crypto (v2), and `invoke`/`receive` over the intermediate framing.
 * This is the low-level engine — most tests use the ergonomic {@link TestSession}
 * (`src/session.ts`) which wraps it. The crypto is shared with the server and
 * pinned by `packages/server/test/crypto.kat.test.ts`.
 */
export class TestClient {
    private frames: Buffer[] = []
    private waiters: Array<(b: Buffer) => void> = []
    private inbound = Buffer.alloc(0)
    private sentInit = false

    private authKey!: Buffer
    private authKeyId!: bigint
    private sessionId = toBigIntLE(randomBytes(8))
    private serverSalt = 0n
    private seq = 0

    constructor(
        private readonly transport: ClientTransport,
        private readonly serverPubKey: KeyObject,
        private readonly codec: TlCodec,
    ) {}

    async connect(): Promise<void> {
        this.transport.onData(chunk => this.onBytes(chunk))
        await this.transport.connect()
    }

    private onBytes(chunk: Buffer): void {
        this.inbound = Buffer.concat([this.inbound, chunk])
        for (;;) {
            if (this.inbound.length < 4) break
            const len = this.inbound.readUInt32LE(0)
            if (this.inbound.length < 4 + len) break
            const packet = Buffer.from(this.inbound.subarray(4, 4 + len))
            this.inbound = this.inbound.subarray(4 + len)
            const waiter = this.waiters.shift()
            if (waiter) waiter(packet)
            else this.frames.push(packet)
        }
    }

    private nextPacket(timeoutMs = 3000): Promise<Buffer> {
        const queued = this.frames.shift()
        if (queued) return Promise.resolve(queued)
        return new Promise((resolve, reject) => {
            const waiter = (b: Buffer): void => {
                clearTimeout(t)
                resolve(b)
            }
            // On timeout, REMOVE the waiter — otherwise a stale waiter lingers and a
            // late-arriving frame is handed to an already-rejected promise (a no-op)
            // and lost. This bites the polling receive loop against a slow server.
            const t = setTimeout(() => {
                const i = this.waiters.indexOf(waiter)
                if (i >= 0) this.waiters.splice(i, 1)
                reject(new Error('timeout waiting for packet'))
            }, timeoutMs)
            this.waiters.push(waiter)
        })
    }

    private sendPacket(packet: Buffer): void {
        const head = this.sentInit ? Buffer.alloc(0) : Buffer.from('eeeeeeee', 'hex')
        this.sentInit = true
        const len = Buffer.alloc(4)
        len.writeUInt32LE(packet.length, 0)
        this.transport.send(Buffer.concat([head, len, packet]))
    }

    private sendPlain(body: TlObject): void {
        const bodyBuf = this.codec.encode(body)
        const w = new TlWriter(bodyBuf.length + 24)
        w.writeLong(0n)
        w.writeLong(genMsgId())
        w.writeUInt32(bodyBuf.length)
        w.writeRaw(bodyBuf)
        this.sendPacket(w.toBuffer())
    }

    private async recvPlainBody(): Promise<Buffer> {
        const packet = await this.nextPacket()
        const len = packet.readUInt32LE(16)
        return packet.subarray(20, 20 + len)
    }

    async handshake(): Promise<void> {
        const nonce = randomBytes(16)
        this.sendPlain({ _: 'req_pq', nonce })

        const r1 = new TlReader(await this.recvPlainBody())
        r1.readUInt32() // resPQ id
        r1.readInt128() // nonce
        const serverNonce = r1.readInt128()
        const pq = r1.readBytes()
        const [p, q] = factorize(toBigIntBE(pq))

        const newNonce = randomBytes(32)
        const innerBuf = this.codec.encode({
            _: 'p_q_inner_data',
            pq,
            p: bigIntToMinBuf(p),
            q: bigIntToMinBuf(q),
            nonce,
            server_nonce: serverNonce,
            new_nonce: newNonce,
        })
        const withHash = Buffer.concat([Buffer.from([0]), sha1(innerBuf), innerBuf])
        const encrypted = Buffer.concat([withHash, randomBytes(256 - withHash.length)])
        const encryptedData = rsaEncryptNoPadding(this.serverPubKey, encrypted)

        this.sendPlain({
            _: 'req_DH_params',
            nonce,
            server_nonce: serverNonce,
            p: bigIntToMinBuf(p),
            q: bigIntToMinBuf(q),
            public_key_fingerprint: 0n,
            encrypted_data: encryptedData,
        })

        const r2 = new TlReader(await this.recvPlainBody())
        r2.readUInt32()
        r2.readInt128()
        r2.readInt128()
        const encAnswer = r2.readBytes()

        const { tmpKey, tmpIv } = deriveTmpAes(newNonce, serverNonce)
        const answer = igeDecrypt(encAnswer, tmpKey, tmpIv)
        const r3 = new TlReader(answer.subarray(20))
        r3.readUInt32()
        r3.readInt128()
        r3.readInt128()
        const g = r3.readInt32()
        const dhPrime = toBigIntBE(r3.readBytes())
        const gA = toBigIntBE(r3.readBytes())

        const b = toBigIntBE(randomBytes(256)) % dhPrime
        const gB = modPow(BigInt(g), b, dhPrime)
        const shared = modPow(gA, b, dhPrime)
        this.authKey = toBufferBE(shared, 256)
        this.authKeyId = toBigIntLE(sha1(this.authKey).subarray(-8))

        const clientInner = this.codec.encode({
            _: 'client_DH_inner_data',
            nonce,
            server_nonce: serverNonce,
            retry_id: 0n,
            g_b: toBufferBE(gB, 256),
        })
        const dataWithHash = Buffer.concat([sha1(clientInner), clientInner])
        const padded = Buffer.concat([dataWithHash, randomBytes((16 - (dataWithHash.length % 16)) % 16)])
        this.sendPlain({
            _: 'set_client_DH_params',
            nonce,
            server_nonce: serverNonce,
            encrypted_data: igeEncrypt(padded, tmpKey, tmpIv),
        })

        const r4 = new TlReader(await this.recvPlainBody())
        r4.readUInt32() // dh_gen_ok id
        const a = r4.readInt128()
        if (a.length !== 16) throw new Error('handshake failed')

        this.serverSalt = toBigIntLE(xorBuffers(newNonce.subarray(0, 8), serverNonce.subarray(0, 8)))
    }

    /** The salt this client encrypts with (server-advertised). */
    get salt(): bigint {
        return this.serverSalt
    }
    set salt(v: bigint) {
        this.serverSalt = v
    }

    /** This client's session id (for `destroy_session` tests). */
    get session(): bigint {
        return this.sessionId
    }

    /** This client's auth key id, set after `handshake` (for storage assertions). */
    get authKey_id(): bigint {
        return this.authKeyId
    }

    /** Next seqno for a content-related (odd, counted) or service (even) message. */
    private nextSeq(contentRelated: boolean): number {
        if (!contentRelated) return this.seq * 2
        return this.seq++ * 2 + 1
    }

    /** Send an encrypted body, collect `expectN` decrypted replies. `opts.salt`
     *  overrides the salt (to exercise `bad_server_salt`); `opts.msgId` overrides the
     *  msg_id and `opts.seqNo` the seqno (to exercise `bad_msg_notification`). The
     *  seqno is otherwise chosen per content-relatedness (odd for queries, even for
     *  pure service messages), matching the protocol. */
    async invoke(body: TlObject, expectN: number, opts: SendOpts = {}): Promise<TlObject[]> {
        const seqNo = opts.seqNo ?? this.nextSeq(isContentRelated(body._))
        return this.send(this.codec.encode(body), seqNo, expectN, opts)
    }

    /** Send a raw inner payload (e.g. a hand-built container) and collect replies. */
    async invokeRaw(
        payload: Buffer,
        seqNo: number,
        expectN: number,
        opts: { salt?: bigint; msgId?: bigint } = {},
    ): Promise<TlObject[]> {
        return this.send(payload, seqNo, expectN, opts)
    }

    /** Encrypt and send a body, returning its msg_id — does NOT wait for replies.
     *  The ergonomic {@link TestSession} uses this to drive its own receive loop
     *  (match `rpc_result.req_msg_id`, route interleaved updates). Seqno follows
     *  content-relatedness like {@link invoke} unless `opts.seqNo` is given. */
    sendBody(body: TlObject, opts: SendOpts = {}): bigint {
        const seqNo = opts.seqNo ?? this.nextSeq(isContentRelated(body._))
        return this.encryptAndSend(this.codec.encode(body), seqNo, opts)
    }

    private async send(payload: Buffer, seqNo: number, expectN: number, opts: SendOpts): Promise<TlObject[]> {
        this.encryptAndSend(payload, seqNo, opts)
        const out: TlObject[] = []
        for (let i = 0; i < expectN; i++) out.push(await this.receive())
        return out
    }

    /** Frame + encrypt one payload and write it; returns the msg_id used. */
    private encryptAndSend(payload: Buffer, seqNo: number, opts: SendOpts): bigint {
        const msgId = opts.msgId ?? genMsgId()
        const w = new TlWriter(payload.length + 32)
        w.writeLong(opts.salt ?? this.serverSalt)
        w.writeLong(this.sessionId)
        w.writeLong(msgId)
        w.writeUInt32(seqNo)
        w.writeUInt32(payload.length)
        w.writeRaw(payload)
        let plain = w.toBuffer()
        const minPad = 12
        const pad = minPad + ((16 - ((plain.length + minPad) % 16)) % 16)
        plain = Buffer.concat([plain, randomBytes(pad)])

        const msgKey = computeMsgKey(this.authKey, plain, false)
        const { aesKey, aesIv } = generateMessageKey(this.authKey, msgKey, false)
        const cipher = igeEncrypt(plain, aesKey, aesIv)
        this.sendPacket(Buffer.concat([toBufferLE(this.authKeyId, 8), msgKey, cipher]))
        return msgId
    }

    /** Wait for and decrypt one server-initiated message (e.g. a pushed update). */
    async receive(timeoutMs = 3000): Promise<TlObject> {
        const packet = await this.nextPacket(timeoutMs)
        const msgKey = packet.subarray(8, 24)
        const cipher = packet.subarray(24)
        const { aesKey, aesIv } = generateMessageKey(this.authKey, msgKey, true)
        const plain = igeDecrypt(cipher, aesKey, aesIv)
        const r = new TlReader(plain)
        r.readLong() // salt
        r.readLong() // session_id
        r.readLong() // msg_id
        r.readUInt32() // seq
        const len = r.readUInt32()
        return this.codec.decode(r.read(len)) as TlObject
    }

    close(): void {
        this.transport.close()
    }
}

// --- crypto helpers ---------------------------------------------------------

function deriveTmpAes(newNonce: Buffer, serverNonce: Buffer): { tmpKey: Buffer; tmpIv: Buffer } {
    const nsn = sha1(Buffer.concat([newNonce, serverNonce]))
    const sns = sha1(Buffer.concat([serverNonce, newNonce]))
    const nnn = sha1(Buffer.concat([newNonce, newNonce]))
    return {
        tmpKey: Buffer.concat([nsn, sns.subarray(0, 12)]),
        tmpIv: Buffer.concat([sns.subarray(12, 20), nnn, newNonce.subarray(0, 4)]),
    }
}

function bigIntToMinBuf(v: bigint): Buffer {
    let hex = v.toString(16)
    if (hex.length % 2) hex = '0' + hex
    return Buffer.from(hex, 'hex')
}

// Client→server messages that do NOT require acknowledgment (carry an even seqno);
// everything else is content-related (odd). Mirrors the server's classification.
const NON_CONTENT_NAMES = new Set([
    'ping',
    'ping_delay_disconnect',
    'msgs_ack',
    'msgs_all_info',
    'http_wait',
    'msg_container',
])
function isContentRelated(name: string): boolean {
    return !NON_CONTENT_NAMES.has(name)
}

let lastId = 0n
/** A protocol-valid client msg_id: unix-seconds<<32, ÷4, strictly increasing. */
export function genMsgId(): bigint {
    let id = (BigInt(Math.floor(Date.now() / 1000)) << 32n) | BigInt((Date.now() % 1000) << 21)
    if (id <= lastId) id = lastId + 4n
    while (id % 4n !== 0n) id++
    lastId = id
    return id
}

// Pollard's rho — factor pq (product of two ~31-bit primes).
function factorize(n: bigint): [bigint, bigint] {
    if (n % 2n === 0n) return [2n, n / 2n]
    const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b))
    const abs = (x: bigint): bigint => (x < 0n ? -x : x)
    for (let c = 1n; ; c++) {
        let x = 2n
        let y = 2n
        let d = 1n
        const f = (v: bigint) => (v * v + c) % n
        while (d === 1n) {
            x = f(x)
            y = f(f(y))
            d = gcd(abs(x - y), n)
        }
        if (d !== n) {
            const other = n / d
            return d < other ? [d, other] : [other, d]
        }
    }
}
