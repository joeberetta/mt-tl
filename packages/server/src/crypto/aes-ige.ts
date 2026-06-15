import { createCipheriv, createDecipheriv } from 'node:crypto'

/**
 * AES-256 in IGE (Infinite Garble Extension) mode, as used by MTProto.
 *
 * Reimplemented on Node's `aes-256-ecb` (the existing server used CryptoJS's
 * IGE). Verified byte-identical against the old lib via a known-answer test.
 * Input length must be a multiple of 16; IV is 32 bytes (two blocks).
 */

function xor16(a: Buffer, b: Buffer): Buffer {
    const out = Buffer.allocUnsafe(16)
    for (let i = 0; i < 16; i++) out[i] = a[i]! ^ b[i]!
    return out
}

export function igeEncrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
    if (data.length % 16 !== 0) throw new Error('IGE: data length must be a multiple of 16')
    if (iv.length !== 32) throw new Error('IGE: iv must be 32 bytes')
    const cipher = createCipheriv('aes-256-ecb', key, null)
    cipher.setAutoPadding(false)

    let prevCipher = iv.subarray(0, 16)
    let prevPlain = iv.subarray(16, 32)
    const out = Buffer.allocUnsafe(data.length)

    for (let i = 0; i < data.length; i += 16) {
        const block = data.subarray(i, i + 16)
        const enc = cipher.update(xor16(block, prevCipher))
        const c = xor16(enc, prevPlain)
        c.copy(out, i)
        prevCipher = c
        prevPlain = Buffer.from(block)
    }
    return out
}

export function igeDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
    if (data.length % 16 !== 0) throw new Error('IGE: data length must be a multiple of 16')
    if (iv.length !== 32) throw new Error('IGE: iv must be 32 bytes')
    const decipher = createDecipheriv('aes-256-ecb', key, null)
    decipher.setAutoPadding(false)

    let prevCipher = iv.subarray(0, 16)
    let prevPlain = iv.subarray(16, 32)
    const out = Buffer.allocUnsafe(data.length)

    for (let i = 0; i < data.length; i += 16) {
        const block = Buffer.from(data.subarray(i, i + 16))
        const dec = decipher.update(xor16(block, prevPlain))
        const p = xor16(dec, prevCipher)
        p.copy(out, i)
        prevCipher = block
        prevPlain = p
    }
    return out
}
