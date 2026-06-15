import {
    constants,
    createPrivateKey,
    createPublicKey,
    generateKeyPairSync,
    privateDecrypt,
    publicEncrypt,
    type KeyObject,
} from 'node:crypto'
import { readFileSync } from 'node:fs'
import { TlWriter } from '../tl/writer.js'
import { sha1 } from './hashes.js'
import { toBigIntLE } from '../util/bytes.js'

export interface RsaKeyPair {
    privateKey: KeyObject
    publicKey: KeyObject
    /** Lower-64-bit key fingerprint advertised to clients in resPQ. */
    fingerprint: bigint
    fingerprintBuf: Buffer
}

/**
 * Telegram RSA fingerprint: take the bare TL serialization of the public key
 * (modulus `n` and exponent `e` as `bytes`), SHA1 it, and use the last 8 bytes.
 */
export function computeFingerprint(publicKey: KeyObject): { fingerprint: bigint; buf: Buffer } {
    const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string }
    const n = Buffer.from(jwk.n, 'base64url')
    const e = Buffer.from(jwk.e, 'base64url')
    const w = new TlWriter()
    w.writeBytes(n)
    w.writeBytes(e)
    const digest = sha1(w.toBuffer())
    const buf = digest.subarray(12, 20)
    return { fingerprint: toBigIntLE(buf), buf: Buffer.from(buf) }
}

/**
 * Loads the gateway's RSA key pair. With `pemPath` set, the operator-provided
 * production key is used (its fingerprint must match what clients have pinned).
 * Without it, an ephemeral 2048-bit key is generated for local dev/testing.
 */
export function loadRsaKeyPair(pemPath?: string): RsaKeyPair {
    let privateKey: KeyObject
    let publicKey: KeyObject

    if (pemPath) {
        const pem = readFileSync(pemPath, 'utf-8')
        privateKey = createPrivateKey(pem)
        publicKey = createPublicKey(privateKey)
    } else {
        const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
        privateKey = pair.privateKey
        publicKey = pair.publicKey
    }

    const { fingerprint, buf } = computeFingerprint(publicKey)
    return { privateKey, publicKey, fingerprint, fingerprintBuf: buf }
}

/** RSA decrypt of the client's `encrypted_data` with no padding (raw 256 bytes). */
export function rsaDecryptNoPadding(privateKey: KeyObject, encryptedData: Buffer): Buffer {
    return privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, encryptedData)
}

/** RSA encrypt with no padding — used only by the test client. */
export function rsaEncryptNoPadding(publicKey: KeyObject, data: Buffer): Buffer {
    return publicEncrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, data)
}
