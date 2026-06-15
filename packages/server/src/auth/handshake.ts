import { randomBytes } from 'node:crypto'
import { noopLogger, type Logger } from '@mt-tl/tl'
import type { TlCodec } from '../tl/codec.js'
import type { TlObject } from '@mt-tl/tl'
import { TlReader } from '../tl/reader.js'
import type { Storage } from '../storage/index.js'
import type { SaltService } from '../session/salts.js'
import { NonceStore } from './nonce-store.js'
import { igeEncrypt, igeDecrypt } from '../crypto/aes-ige.js'
import { sha1, xorBuffers } from '../crypto/hashes.js'
import { rsaDecryptNoPadding, type RsaKeyPair } from '../crypto/rsa.js'
import { DH_G, DH_PRIME, DH_PRIME_BIGINT, makePQ, modPow, calculatePadding } from '../crypto/dh.js'
import { toBigIntBE, toBigIntLE, toBufferBE } from '../util/bytes.js'

// Immutable protocol constructor ids.
const ID_REQ_PQ = 0x60469778
const ID_REQ_PQ_MULTI = 0xbe7e8ef1
const ID_REQ_DH_PARAMS = 0xd712e4be
const ID_SET_CLIENT_DH_PARAMS = 0xf5045f1f

const ID_P_Q_INNER_DATA = 0x83c95aec
const ID_P_Q_INNER_DATA_DC = 0xa9f55f95
const ID_P_Q_INNER_DATA_TEMP = 0x3c6a84d4
const ID_P_Q_INNER_DATA_TEMP_DC = 0x56fddf88
const ID_CLIENT_DH_INNER_DATA = 0x6643b654

/** Raw -404 (regenerate key) sent when handshake state is missing/invalid. */
const ERR_404 = Buffer.from('6cfeffff', 'hex')

export interface HandshakeDeps {
    codec: TlCodec
    rsa: RsaKeyPair
    storage: Storage
    saltService: SaltService
    nonceStore: NonceStore
    defaultLayer: number
    /** Observability sink; defaults to a no-op logger. */
    logger?: Logger
}

export type HandshakeReply = { reply: TlObject } | { raw: Buffer } | null

export class Handshake {
    private readonly logger: Logger

    constructor(private readonly deps: HandshakeDeps) {
        this.logger = deps.logger ?? noopLogger
    }

    static isHandshakeId(id: number): boolean {
        return (
            id === ID_REQ_PQ ||
            id === ID_REQ_PQ_MULTI ||
            id === ID_REQ_DH_PARAMS ||
            id === ID_SET_CLIENT_DH_PARAMS
        )
    }

    /** `reader` is positioned just after the 4-byte constructor id. */
    async handle(id: number, reader: TlReader): Promise<HandshakeReply> {
        try {
            switch (id) {
                case ID_REQ_PQ:
                case ID_REQ_PQ_MULTI:
                    return this.handleReqPq(reader.readInt128())
                case ID_REQ_DH_PARAMS:
                    return this.handleReqDhParams(reader)
                case ID_SET_CLIENT_DH_PARAMS:
                    return this.handleSetClientDhParams(reader)
                default:
                    return null
            }
        } catch (e) {
            // A malformed/forged handshake step; reply -404 (regenerate key). Client
            // fault, not server fault → warn, with the step id for correlation.
            this.logger.warn('handshake.error', { step: id.toString(16), err: e })
            return { raw: ERR_404 }
        }
    }

    private handleReqPq(clientNonce: Buffer): HandshakeReply {
        const serverNonce = randomBytes(16)
        const { p, q, pq } = makePQ()
        this.deps.nonceStore.set(clientNonce.toString('hex'), { clientNonce, serverNonce, p, q, pq })

        const reply: TlObject = {
            _: 'resPQ',
            nonce: clientNonce,
            server_nonce: serverNonce,
            pq,
            server_public_key_fingerprints: [this.deps.rsa.fingerprint],
        }
        return { reply }
    }

    private handleReqDhParams(reader: TlReader): HandshakeReply {
        const nonce = reader.readInt128()
        const serverNonce = reader.readInt128()
        reader.readBytes() // p
        reader.readBytes() // q
        reader.readLong() // public_key_fingerprint
        const encryptedData = reader.readBytes()

        const nd = this.deps.nonceStore.get(nonce.toString('hex'))
        if (!nd) return { raw: ERR_404 }

        // RSA decrypt -> [0x00][sha1(20)][ctor id (4)][p_q_inner_data fields][padding]
        const data = rsaDecryptNoPadding(this.deps.rsa.privateKey, encryptedData)
        const inner = readPqInnerData(data.subarray(21))
        if (!inner) return { raw: ERR_404 }

        nd.newClientNonce = inner.newNonce
        nd.expiresIn = inner.expiresIn ?? false

        // server_DH_inner_data
        const a = randomBelow(DH_PRIME_BIGINT)
        nd.a = a
        const gA = toBufferBE(modPow(BigInt(DH_G), a, DH_PRIME_BIGINT), 256)

        const innerData: TlObject = {
            _: 'server_DH_inner_data',
            nonce,
            server_nonce: serverNonce,
            g: DH_G,
            dh_prime: DH_PRIME,
            g_a: gA,
            server_time: Math.floor(Date.now() / 1000),
        }
        const innerBytes = this.deps.codec.encode(innerData)
        const innerHash = sha1(innerBytes)
        const padLen = calculatePadding(innerHash.length + innerBytes.length, 16)
        const plainAnswer = Buffer.concat([
            innerHash,
            innerBytes,
            padLen > 0 ? randomBytes(padLen) : Buffer.alloc(0),
        ])

        const { tmpAesKey, tmpAesIv } = deriveTmpAes(nd.newClientNonce, serverNonce)
        nd.tmpAesKey = tmpAesKey
        nd.tmpAesIv = tmpAesIv
        this.deps.nonceStore.set(nonce.toString('hex'), nd)

        const reply: TlObject = {
            _: 'server_DH_params_ok',
            nonce,
            server_nonce: serverNonce,
            encrypted_answer: igeEncrypt(plainAnswer, tmpAesKey, tmpAesIv),
        }
        return { reply }
    }

    private async handleSetClientDhParams(reader: TlReader): Promise<HandshakeReply> {
        const nonce = reader.readInt128()
        reader.readInt128() // server_nonce
        const encryptedData = reader.readBytes()

        const nd = this.deps.nonceStore.get(nonce.toString('hex'))
        if (!nd || !nd.tmpAesKey || !nd.tmpAesIv || !nd.a || !nd.newClientNonce) {
            return { raw: ERR_404 }
        }

        const data = igeDecrypt(encryptedData, nd.tmpAesKey, nd.tmpAesIv)
        // [sha1(20)][ctor id (4)][client_DH_inner_data fields]
        if (data.readUInt32LE(20) !== ID_CLIENT_DH_INNER_DATA) return { raw: ERR_404 }
        const gB = readClientDhInner(data.subarray(24))

        const key = toBufferBE(modPow(toBigIntBE(gB), nd.a, DH_PRIME_BIGINT), 256)
        const keyHash = sha1(key)
        const keyId = toBigIntLE(keyHash.subarray(-8))
        // Wire-compat: the FIRST salt keeps its legacy xor(newNonce, serverNonce)
        // derivation; it just becomes window 0 of the rolling schedule.
        const serverSalt = toBigIntLE(
            xorBuffers(nd.newClientNonce.subarray(0, 8), nd.serverNonce.subarray(0, 8)),
        )

        await this.deps.storage.authKeys.create({
            id: keyId,
            key,
            expiresIn: nd.expiresIn ? true : false,
            createdAt: new Date(),
            subject: null,
            meta: { apiLayer: this.deps.defaultLayer },
        })
        await this.deps.saltService.seed(keyId, serverSalt)
        // A new auth key was negotiated and persisted (an anonymous key until a
        // handler binds a user to it).
        this.logger.info('authkey.create', { authKeyId: keyId, temp: !!nd.expiresIn })

        const newNonceHash1 = sha1(
            Buffer.concat([nd.newClientNonce, Buffer.from([1]), keyHash.subarray(0, 8)]),
        ).subarray(-16)

        this.deps.nonceStore.delete(nonce.toString('hex'))

        const reply: TlObject = {
            _: 'dh_gen_ok',
            nonce,
            server_nonce: nd.serverNonce,
            new_nonce_hash1: Buffer.from(newNonceHash1),
        }
        return { reply }
    }
}

// --- hand-decoders for the binary-bearing inner structures -----------------

interface PqInner {
    newNonce: Buffer
    expiresIn?: number
}

function readPqInnerData(buf: Buffer): PqInner | null {
    const r = new TlReader(buf)
    const id = r.readUInt32()
    if (
        id !== ID_P_Q_INNER_DATA &&
        id !== ID_P_Q_INNER_DATA_DC &&
        id !== ID_P_Q_INNER_DATA_TEMP &&
        id !== ID_P_Q_INNER_DATA_TEMP_DC
    ) {
        return null
    }
    r.readBytes() // pq
    r.readBytes() // p
    r.readBytes() // q
    r.readInt128() // nonce
    r.readInt128() // server_nonce
    const newNonce = r.readInt256()
    if (id === ID_P_Q_INNER_DATA_DC || id === ID_P_Q_INNER_DATA_TEMP_DC) r.readInt32() // dc
    let expiresIn: number | undefined
    if (id === ID_P_Q_INNER_DATA_TEMP || id === ID_P_Q_INNER_DATA_TEMP_DC) expiresIn = r.readInt32()
    return { newNonce, expiresIn }
}

/** Reads client_DH_inner_data fields (after its ctor id) and returns g_b bytes. */
function readClientDhInner(buf: Buffer): Buffer {
    const r = new TlReader(buf)
    r.readInt128() // nonce
    r.readInt128() // server_nonce
    r.readLong() // retry_id
    return r.readBytes() // g_b
}

// --- crypto helpers ---------------------------------------------------------

function deriveTmpAes(newNonce: Buffer, serverNonce: Buffer): { tmpAesKey: Buffer; tmpAesIv: Buffer } {
    const nsn = sha1(Buffer.concat([newNonce, serverNonce]))
    const sns = sha1(Buffer.concat([serverNonce, newNonce]))
    const nnn = sha1(Buffer.concat([newNonce, newNonce]))
    return {
        tmpAesKey: Buffer.concat([nsn, sns.subarray(0, 12)]),
        tmpAesIv: Buffer.concat([sns.subarray(12, 20), nnn, newNonce.subarray(0, 4)]),
    }
}

function randomBelow(limit: bigint): bigint {
    let a: bigint
    do {
        a = toBigIntBE(randomBytes(256))
    } while (a >= limit || a < 2n)
    return a
}
