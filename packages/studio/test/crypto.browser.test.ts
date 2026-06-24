import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, randomBytes, createCipheriv } from 'node:crypto'
import * as bc from '../src/client/crypto.js'
import {
    sha1 as nodeSha1,
    igeEncrypt as nodeIge,
    generateMessageKey as nodeGmk,
    computeMsgKey as nodeCmk,
    rsaEncryptNoPadding as nodeRsa,
} from '@mt-tl/server/testkit'

// The browser crypto core must be byte-identical to the framework's node crypto,
// or a handshake done in the studio playground won't be understood by the server.
const eq = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b))

describe('browser crypto ≡ node crypto', () => {
    it('sha1', () => {
        const d = randomBytes(123)
        expect(eq(bc.sha1(d), nodeSha1(d))).toBe(true)
    })

    it('aes-256-ige: matches node + round-trips', () => {
        const key = randomBytes(32)
        const iv = randomBytes(32)
        const data = randomBytes(80)
        const enc = bc.igeEncrypt(data, key, iv)
        expect(eq(enc, nodeIge(data, key, iv))).toBe(true)
        expect(eq(bc.igeDecrypt(enc, key, iv), data)).toBe(true)
    })

    it('message-key derivation (both directions)', () => {
        const authKey = randomBytes(256)
        const msgKey = randomBytes(16)
        for (const outgoing of [false, true]) {
            const mine = bc.generateMessageKey(authKey, msgKey, outgoing)
            const node = nodeGmk(authKey, msgKey, outgoing)
            expect(eq(mine.aesKey, node.aesKey)).toBe(true)
            expect(eq(mine.aesIv, node.aesIv)).toBe(true)
        }
    })

    it('computeMsgKey (exercises sha256)', () => {
        const authKey = randomBytes(256)
        const plaintext = randomBytes(48)
        expect(eq(bc.computeMsgKey(authKey, plaintext, false), nodeCmk(authKey, plaintext, false))).toBe(true)
    })

    it('aes-256-ctr (transport obfuscation): continuous stream matches node across split chunks', () => {
        const key = randomBytes(32)
        const iv = randomBytes(16)
        const data = randomBytes(1000)
        const ref = createCipheriv('aes-256-ctr', key, iv)
        const expected = Buffer.concat([ref.update(data), ref.final()])

        // Feed through our stateful CTR in irregular chunks that cross block boundaries.
        const enc = bc.createCtr(key, iv)
        const chunks = [7, 16, 1, 100, 33, 256, 9, 578]
        const out = new Uint8Array(data.length)
        let off = 0
        for (const n of chunks) {
            out.set(enc(data.subarray(off, off + n)), off)
            off += n
        }
        expect(eq(out, expected)).toBe(true)
        // CTR is symmetric: a fresh instance decrypts back to plaintext.
        expect(eq(bc.createCtr(key, iv)(out), data)).toBe(true)
    })

    it('rsa no-padding: matches node for a real 2048-bit key (from PEM)', () => {
        const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
        const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string
        const data = randomBytes(256)
        data[0] = 0 // keep the integer below the modulus
        expect(eq(bc.rsaEncryptNoPadding(pem, data), nodeRsa(publicKey, data))).toBe(true)
    })
})
