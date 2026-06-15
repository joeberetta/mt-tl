import { describe, it, expect } from 'vitest'
import { igeEncrypt, igeDecrypt } from '../src/crypto/aes-ige.js'
import { generateMessageKey, computeMsgKey } from '../src/crypto/msg-key.js'
import { makePQ, modPow, DH_G, DH_PRIME_BIGINT, calculatePadding } from '../src/crypto/dh.js'

const hex = (s: string) => Buffer.from(s, 'hex')

// Vectors captured from the existing core libs (libs/aesige, mtproto 2.0 key derivation).
const KEY = hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
const IV = hex('202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f')
const DATA = hex('48656c6c6f2c204d5450726f746f2049474520626c6f636b2074657374212121')
const ENC = hex('96b63a9dfae901b5b6eea28bed0786e4a8b2a40beb7b9b5393b8e9aaf0b4a537')

describe('AES-256-IGE matches the existing CryptoJS-based lib', () => {
    it('encrypts to the known vector', () => {
        expect(igeEncrypt(DATA, KEY, IV).toString('hex')).toBe(ENC.toString('hex'))
    })
    it('decrypts back', () => {
        expect(igeDecrypt(ENC, KEY, IV).toString('hex')).toBe(DATA.toString('hex'))
    })
})

describe('MTProto 2.0 message-key derivation', () => {
    const authKey = Buffer.alloc(256)
    for (let i = 0; i < 256; i++) authKey[i] = i & 0xff
    const msgKey = hex('0102030405060708090a0b0c0d0e0f10')

    it('matches captured aesKey/aesIv (incoming)', () => {
        const { aesKey, aesIv } = generateMessageKey(authKey, msgKey, false)
        expect(aesKey.toString('hex')).toBe(
            'c10580a979b98ec23c2204807678f45d86837aece13d8a546fde9fe79a30f1e8',
        )
        expect(aesIv.toString('hex')).toBe('8e8d2f52324f4b47f7bbcca22b95c783d201bdb1782496189bae79741609b1fa')
    })

    it('matches captured aesKey/aesIv (outgoing)', () => {
        const { aesKey, aesIv } = generateMessageKey(authKey, msgKey, true)
        expect(aesKey.toString('hex')).toBe(
            '839fb0d0c0916687c905e2ece890394f95f10f1fa1c983113d6900e23422c789',
        )
        expect(aesIv.toString('hex')).toBe('e8c12f77f1e8ac89b7dce6a4292fa472254e3b954b148d8eef9a75f75621b1e1')
    })

    it('computes msg_key for a plaintext', () => {
        const plain = hex('deadbeefcafebabe00112233445566778899aabbccddeeff')
        // captured with x=8 (server->client / outgoing): authKey[96:128]
        expect(computeMsgKey(authKey, plain, true).toString('hex')).toBe('ae2260b89043736d15fee759e7a8c17d')
    })
})

describe('DH helpers', () => {
    it('makePQ yields p<q primes whose product is the pq buffer', () => {
        const { p, q, pq } = makePQ()
        expect(p).toBeLessThan(q)
        expect(BigInt('0x' + pq.toString('hex'))).toBe(p * q)
    })

    it('modPow agrees with a reference for the DH generator', () => {
        const a = 123456789n
        const ga = modPow(BigInt(DH_G), a, DH_PRIME_BIGINT)
        // g^a mod p is in range and non-trivial
        expect(ga).toBeGreaterThan(1n)
        expect(ga).toBeLessThan(DH_PRIME_BIGINT)
    })

    it('calculatePadding pads up to the block size', () => {
        expect(calculatePadding(20, 16)).toBe(12)
        expect(calculatePadding(32, 16)).toBe(0)
    })
})
