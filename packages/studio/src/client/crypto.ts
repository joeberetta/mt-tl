import { sha1 as nobleSha1 } from '@noble/hashes/sha1'
import { sha256 as nobleSha256 } from '@noble/hashes/sha256'
import { ecb } from '@noble/ciphers/aes'

// Browser-native MTProto crypto core — mirrors @mt-tl/server's node crypto
// (which uses node:crypto) so a handshake done here is byte-identical. Built on
// audited primitives (@noble/hashes, @noble/ciphers) + BigInt; everything is
// Uint8Array, sync, no node:crypto. Verified against the node impl in
// test/crypto.browser.test.ts.

export const sha1 = (data: Uint8Array): Uint8Array => nobleSha1(data)
export const sha256 = (data: Uint8Array): Uint8Array => nobleSha256(data)

export function randomBytes(n: number): Uint8Array {
    const b = new Uint8Array(n)
    crypto.getRandomValues(b)
    return b
}

export function concatBytes(...arrs: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(arrs.reduce((a, x) => a + x.length, 0))
    let o = 0
    for (const a of arrs) {
        out.set(a, o)
        o += a.length
    }
    return out
}

function xor16(a: Uint8Array, b: Uint8Array): Uint8Array {
    const o = new Uint8Array(16)
    for (let i = 0; i < 16; i++) o[i] = a[i]! ^ b[i]!
    return o
}

// noble's `ecb` instance refuses a second encrypt/decrypt (reuse guard), so make
// a fresh one-block cipher per call. Fine for handshake/RPC-sized payloads.
const aesEcbEncrypt = (key: Uint8Array, block: Uint8Array) => ecb(key, { disablePadding: true }).encrypt(block)
const aesEcbDecrypt = (key: Uint8Array, block: Uint8Array) => ecb(key, { disablePadding: true }).decrypt(block)

/** AES-256 IGE encrypt. `iv` is 32 bytes (two blocks); `data` a multiple of 16. */
export function igeEncrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
    if (data.length % 16 !== 0) throw new Error('IGE: data length must be a multiple of 16')
    if (iv.length !== 32) throw new Error('IGE: iv must be 32 bytes')
    let prevC = iv.subarray(0, 16)
    let prevP = iv.subarray(16, 32)
    const out = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i += 16) {
        const block = data.subarray(i, i + 16)
        const c = xor16(aesEcbEncrypt(key, xor16(block, prevC)), prevP)
        out.set(c, i)
        prevC = c
        prevP = block.slice()
    }
    return out
}

/** AES-256 IGE decrypt. */
export function igeDecrypt(data: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
    if (data.length % 16 !== 0) throw new Error('IGE: data length must be a multiple of 16')
    if (iv.length !== 32) throw new Error('IGE: iv must be 32 bytes')
    let prevC = iv.subarray(0, 16)
    let prevP = iv.subarray(16, 32)
    const out = new Uint8Array(data.length)
    for (let i = 0; i < data.length; i += 16) {
        const block = data.subarray(i, i + 16)
        const p = xor16(aesEcbDecrypt(key, xor16(block, prevP)), prevC)
        out.set(p, i)
        prevC = block.slice()
        prevP = p
    }
    return out
}

/**
 * Stateful AES-256-CTR keystream cipher for transport obfuscation (MTProto's
 * "obfuscated" transport, required for WebSocket). The 128-bit counter is seeded
 * from `iv` and advances continuously (big-endian +1 per block) across calls, so
 * the same instance must be reused for the whole connection. Encrypt and decrypt
 * are the same XOR-with-keystream operation. See core.telegram.org/mtproto/mtproto-transports#transport-obfuscation.
 */
export function createCtr(key: Uint8Array, iv: Uint8Array): (data: Uint8Array) => Uint8Array {
    const counter = new Uint8Array(iv) // 16-byte big-endian counter, mutated in place (copy: never alias the iv)
    let keystream: Uint8Array = new Uint8Array(0)
    let ksPos = 0
    const increment = (): void => {
        for (let i = 15; i >= 0; i--) {
            counter[i] = (counter[i]! + 1) & 0xff
            if (counter[i] !== 0) break
        }
    }
    return (data: Uint8Array): Uint8Array => {
        const out = new Uint8Array(data.length)
        for (let i = 0; i < data.length; i++) {
            if (ksPos >= keystream.length) {
                keystream = aesEcbEncrypt(key, counter) // E(counter) is the next keystream block
                increment()
                ksPos = 0
            }
            out[i] = data[i]! ^ keystream[ksPos++]!
        }
        return out
    }
}

/** MTProto 2.0 AES key/IV derivation (`outgoing` selects the key half; client→server x=0). */
export function generateMessageKey(
    authKey: Uint8Array,
    msgKey: Uint8Array,
    outgoing: boolean,
): { aesKey: Uint8Array; aesIv: Uint8Array } {
    const x = outgoing ? 8 : 0
    const a = sha256(concatBytes(msgKey, authKey.subarray(x, x + 36)))
    const b = sha256(concatBytes(authKey.subarray(x + 40, x + 76), msgKey))
    return {
        aesKey: concatBytes(a.subarray(0, 8), b.subarray(8, 24), a.subarray(24, 32)),
        aesIv: concatBytes(b.subarray(0, 8), a.subarray(8, 24), b.subarray(24, 32)),
    }
}

/** msg_key = SHA256(authKey[88+x : +32] ‖ plaintext)[8:24]; x=0 client→server. */
export function computeMsgKey(authKey: Uint8Array, plaintext: Uint8Array, outgoing: boolean): Uint8Array {
    const x = outgoing ? 8 : 0
    return sha256(concatBytes(authKey.subarray(88 + x, 88 + x + 32), plaintext)).subarray(8, 24)
}

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let r = 1n
    base %= mod
    while (exp > 0n) {
        if (exp & 1n) r = (r * base) % mod
        exp >>= 1n
        base = (base * base) % mod
    }
    return r
}

export function bytesToBigInt(b: Uint8Array): bigint {
    let n = 0n
    for (const x of b) n = (n << 8n) | BigInt(x)
    return n
}

export function bigIntToBytes(n: bigint, len: number): Uint8Array {
    const out = new Uint8Array(len)
    for (let i = len - 1; i >= 0; i--) {
        out[i] = Number(n & 0xffn)
        n >>= 8n
    }
    return out
}

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
}

/** Parse a PEM RSA public key (SPKI `BEGIN PUBLIC KEY` or PKCS#1) → modulus + exponent. */
export function parseRsaPublicKey(pem: string): { n: bigint; e: bigint } {
    const der = base64ToBytes(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
    let pos = 0
    // Read one DER TLV at `pos`; return its tag + content span; leave pos AFTER it.
    const tlv = (): { tag: number; start: number; end: number } => {
        const tag = der[pos++]!
        let l = der[pos++]!
        if (l & 0x80) {
            let num = l & 0x7f
            l = 0
            while (num-- > 0) l = (l << 8) | der[pos++]!
        }
        const start = pos
        pos = start + l
        return { tag, start, end: start + l }
    }
    const outer = tlv() // outer SEQUENCE
    pos = outer.start
    if (der[pos] === 0x30) {
        // SPKI: AlgorithmIdentifier SEQUENCE, then a BIT STRING wrapping RSAPublicKey.
        tlv() // skip AlgorithmIdentifier
        const bits = tlv() // BIT STRING
        pos = bits.start + 1 // skip the leading "unused bits" byte (0x00)
        const rsaPub = tlv() // RSAPublicKey SEQUENCE
        pos = rsaPub.start
    }
    const int = (): bigint => {
        const t = tlv()
        let b = der.subarray(t.start, t.end)
        while (b.length > 1 && b[0] === 0) b = b.subarray(1) // strip sign byte
        return bytesToBigInt(b)
    }
    return { n: int(), e: int() }
}

/** Raw RSA (no padding): m^e mod n, output sized to the modulus — for the handshake. */
export function rsaEncryptNoPadding(publicKeyPem: string, data: Uint8Array): Uint8Array {
    const { n, e } = parseRsaPublicKey(publicKeyPem)
    const byteLen = Math.ceil(n.toString(2).length / 8)
    return bigIntToBytes(modPow(bytesToBigInt(data), e, n), byteLen)
}
