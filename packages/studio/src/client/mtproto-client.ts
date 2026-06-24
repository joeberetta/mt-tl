import {
    sha1,
    igeEncrypt,
    igeDecrypt,
    generateMessageKey,
    computeMsgKey,
    modPow,
    rsaEncryptNoPadding,
    parseRsaPublicKey,
    randomBytes,
} from './crypto.js'
import {
    toBigIntBE,
    toBigIntLE,
    toBytesBE,
    toBytesLE,
    xorBytes,
    concat,
    bigIntToMinBytes,
} from './bytes.js'
import { TlReader } from './reader.js'
import { TlWriter } from './writer.js'
import type { TlCodec, BObject, BValue } from './codec.js'
import type { ClientTransport } from './transport.js'

/** Overrides for a single encrypted send (exercise bad_server_salt / bad_msg_notification). */
export interface SendOpts {
    salt?: bigint
    msgId?: bigint
    seqNo?: number
}

/**
 * A protocol-correct MTProto 2.0 client for the browser: full RSA/DH handshake,
 * AES-IGE + msg_key crypto (v2), and `invoke`/`receive` over the intermediate
 * framing. A byte-for-byte port of @mt-tl/testing's TestClient with node crypto
 * + the `ws` package swapped for the browser crypto core + native WebSocket; the
 * crypto and codec are KAT-pinned against the node engine.
 */
export class MtprotoClient {
    private frames: Uint8Array[] = []
    private waiters: Array<(b: Uint8Array) => void> = []
    private inbound: Uint8Array = new Uint8Array(0)
    private sentInit = false

    private authKey!: Uint8Array
    private authKeyId!: bigint
    private sessionId = toBigIntLE(randomBytes(8))
    private serverSalt = 0n
    private seq = 0

    constructor(
        private readonly transport: ClientTransport,
        private readonly serverPubKeyPem: string,
        private readonly codec: TlCodec,
        /** When the transport already declares the intermediate protocol id in its
         *  obfuscation init (offset 56), skip the standalone 0xeeeeeeee header. */
        obfuscated = false,
    ) {
        this.sentInit = obfuscated
    }

    async connect(): Promise<void> {
        this.transport.onData(chunk => this.onBytes(chunk))
        await this.transport.connect()
    }

    /** Register a callback for when the underlying socket closes. */
    onClose(cb: () => void): void {
        this.transport.onClose?.(cb)
    }

    private onBytes(chunk: Uint8Array): void {
        this.inbound = concat(this.inbound, chunk)
        for (;;) {
            if (this.inbound.length < 4) break
            const len = new DataView(this.inbound.buffer, this.inbound.byteOffset, 4).getUint32(0, true)
            if (this.inbound.length < 4 + len) break
            const packet = this.inbound.slice(4, 4 + len)
            this.inbound = this.inbound.slice(4 + len)
            const waiter = this.waiters.shift()
            if (waiter) waiter(packet)
            else this.frames.push(packet)
        }
    }

    private nextPacket(timeoutMs = 5000): Promise<Uint8Array> {
        const queued = this.frames.shift()
        if (queued) return Promise.resolve(queued)
        return new Promise((resolve, reject) => {
            const waiter = (b: Uint8Array): void => {
                clearTimeout(t)
                resolve(b)
            }
            const t = setTimeout(() => {
                const i = this.waiters.indexOf(waiter)
                if (i >= 0) this.waiters.splice(i, 1)
                reject(new Error('timeout waiting for packet'))
            }, timeoutMs)
            this.waiters.push(waiter)
        })
    }

    private sendPacket(packet: Uint8Array): void {
        const head = this.sentInit ? new Uint8Array(0) : Uint8Array.from([0xee, 0xee, 0xee, 0xee])
        this.sentInit = true
        const len = new Uint8Array(4)
        new DataView(len.buffer).setUint32(0, packet.length, true)
        this.transport.send(concat(head, len, packet))
    }

    private sendPlain(body: BObject): void {
        const bodyBuf = this.codec.encode(body)
        const w = new TlWriter(bodyBuf.length + 24)
        w.writeLong(0n)
        w.writeLong(genMsgId())
        w.writeUInt32(bodyBuf.length)
        w.writeRaw(bodyBuf)
        this.sendPacket(w.toBytes())
    }

    private async recvPlainBody(): Promise<Uint8Array> {
        const packet = await this.nextPacket()
        const len = new DataView(packet.buffer, packet.byteOffset + 16, 4).getUint32(0, true)
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
            p: bigIntToMinBytes(p),
            q: bigIntToMinBytes(q),
            nonce,
            server_nonce: serverNonce,
            new_nonce: newNonce,
        })
        const withHash = concat(Uint8Array.from([0]), sha1(innerBuf), innerBuf)
        const encrypted = concat(withHash, randomBytes(256 - withHash.length))
        const encryptedData = rsaEncryptNoPadding(this.serverPubKeyPem, encrypted)

        this.sendPlain({
            _: 'req_DH_params',
            nonce,
            server_nonce: serverNonce,
            p: bigIntToMinBytes(p),
            q: bigIntToMinBytes(q),
            public_key_fingerprint: rsaFingerprint(this.serverPubKeyPem),
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
        this.authKey = toBytesBE(shared, 256)
        this.authKeyId = toBigIntLE(sha1(this.authKey).subarray(-8))

        const clientInner = this.codec.encode({
            _: 'client_DH_inner_data',
            nonce,
            server_nonce: serverNonce,
            retry_id: 0n,
            g_b: toBytesBE(gB, 256),
        })
        const dataWithHash = concat(sha1(clientInner), clientInner)
        const padded = concat(dataWithHash, randomBytes((16 - (dataWithHash.length % 16)) % 16))
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

        this.serverSalt = toBigIntLE(xorBytes(newNonce.subarray(0, 8), serverNonce.subarray(0, 8)))
    }

    /** The salt this client encrypts with (server-advertised). */
    get salt(): bigint {
        return this.serverSalt
    }
    set salt(v: bigint) {
        this.serverSalt = v
    }

    /** This client's session id. */
    get session(): bigint {
        return this.sessionId
    }

    /** This client's auth key id, set after `handshake`. */
    get authKey_id(): bigint {
        return this.authKeyId
    }

    private nextSeq(contentRelated: boolean): number {
        if (!contentRelated) return this.seq * 2
        return this.seq++ * 2 + 1
    }

    /** Send an encrypted body, collect `expectN` decrypted replies. */
    async invoke(body: BObject, expectN: number, opts: SendOpts = {}): Promise<BObject[]> {
        const seqNo = opts.seqNo ?? this.nextSeq(isContentRelated(body._))
        return this.send(this.codec.encode(body), seqNo, expectN, opts)
    }

    /** Send a raw inner payload and collect replies. */
    async invokeRaw(payload: Uint8Array, seqNo: number, expectN: number, opts: SendOpts = {}): Promise<BObject[]> {
        return this.send(payload, seqNo, expectN, opts)
    }

    /** Encrypt + send a body, returning its msg_id — does NOT wait for replies. */
    sendBody(body: BObject, opts: SendOpts = {}): bigint {
        const seqNo = opts.seqNo ?? this.nextSeq(isContentRelated(body._))
        return this.encryptAndSend(this.codec.encode(body), seqNo, opts)
    }

    private async send(payload: Uint8Array, seqNo: number, expectN: number, opts: SendOpts): Promise<BObject[]> {
        this.encryptAndSend(payload, seqNo, opts)
        const out: BObject[] = []
        for (let i = 0; i < expectN; i++) out.push(await this.receive())
        return out
    }

    private encryptAndSend(payload: Uint8Array, seqNo: number, opts: SendOpts): bigint {
        const msgId = opts.msgId ?? genMsgId()
        const w = new TlWriter(payload.length + 32)
        w.writeLong(opts.salt ?? this.serverSalt)
        w.writeLong(this.sessionId)
        w.writeLong(msgId)
        w.writeUInt32(seqNo)
        w.writeUInt32(payload.length)
        w.writeRaw(payload)
        let plain = w.toBytes()
        const minPad = 12
        const pad = minPad + ((16 - ((plain.length + minPad) % 16)) % 16)
        plain = concat(plain, randomBytes(pad))

        const msgKey = computeMsgKey(this.authKey, plain, false)
        const { aesKey, aesIv } = generateMessageKey(this.authKey, msgKey, false)
        const cipher = igeEncrypt(plain, aesKey, aesIv)
        this.sendPacket(concat(toBytesLE(this.authKeyId, 8), msgKey, cipher))
        return msgId
    }

    /** Wait for and decrypt one server message (reply or pushed update). */
    async receive(timeoutMs = 5000): Promise<BObject> {
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
        return this.inflate(this.codec.decode(r.read(len)) as BObject)
    }

    /** Telegram gzip-compresses large replies: a `gzip_packed` wraps the real object
     *  (as an rpc_result's `result`, a container member, or the whole body). Inflate
     *  transparently so callers never see `gzip_packed`. */
    private async inflate(obj: BObject): Promise<BObject> {
        if (obj._ === 'gzip_packed') {
            const raw = await gunzip(obj.packed_data as Uint8Array)
            return this.inflate(this.codec.decode(raw) as BObject)
        }
        if (obj._ === 'rpc_result') {
            const o = obj as Record<string, unknown>
            const res = o.result as BObject | undefined
            if (res && typeof res === 'object' && res._ === 'gzip_packed') o.result = await this.inflate(res)
        } else if (obj._ === 'msg_container') {
            const o = obj as Record<string, unknown>
            const msgs = o.messages as BObject[] | undefined
            if (Array.isArray(msgs)) for (let i = 0; i < msgs.length; i++) msgs[i] = await this.inflate(msgs[i]!)
        }
        return obj
    }

    close(): void {
        this.transport.close()
    }
}

/** Gunzip `gzip_packed.packed_data` via the browser's DecompressionStream (RFC 1952). */
async function gunzip(data: Uint8Array): Promise<Uint8Array> {
    const ds = new DecompressionStream('gzip')
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
    return new Uint8Array(await new Response(stream).arrayBuffer())
}

// --- crypto helpers (ported from the node client) ---------------------------

/** Standard MTProto RSA key fingerprint: low 64 bits of sha1(bytes(n) ‖ bytes(e)),
 *  little-endian. The mt-tl gateway ignores it, but real servers (e.g. Telegram)
 *  pin by it — so compute it from the provided PEM instead of sending 0. */
function rsaFingerprint(pem: string): bigint {
    const { n, e } = parseRsaPublicKey(pem)
    const w = new TlWriter()
    w.writeBytes(bigIntToMinBytes(n))
    w.writeBytes(bigIntToMinBytes(e))
    return toBigIntLE(sha1(w.toBytes()).subarray(-8))
}

function deriveTmpAes(newNonce: Uint8Array, serverNonce: Uint8Array): { tmpKey: Uint8Array; tmpIv: Uint8Array } {
    const nsn = sha1(concat(newNonce, serverNonce))
    const sns = sha1(concat(serverNonce, newNonce))
    const nnn = sha1(concat(newNonce, newNonce))
    return {
        tmpKey: concat(nsn, sns.subarray(0, 12)),
        tmpIv: concat(sns.subarray(12, 20), nnn, newNonce.subarray(0, 4)),
    }
}

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
    const now = Date.now()
    let id = (BigInt(Math.floor(now / 1000)) << 32n) | BigInt((now % 1000) << 21)
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

// re-export so a recipe/playground can reference the value type
export type { BValue }
