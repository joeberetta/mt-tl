/**
 * Pure-JS BigInt <-> Buffer helpers (little/big endian).
 * Replaces the native `bigint-buffer` dependency so the gateway has no
 * node-gyp build step. Values are treated as unsigned; this matches the
 * existing server's `toBigIntLE`/`toBufferLE` usage for MTProto longs/ids.
 */

export function toBigIntLE(buf: Buffer): bigint {
    let result = 0n
    for (let i = buf.length - 1; i >= 0; i--) {
        result = (result << 8n) | BigInt(buf[i]!)
    }
    return result
}

export function toBigIntBE(buf: Buffer): bigint {
    let result = 0n
    for (let i = 0; i < buf.length; i++) {
        result = (result << 8n) | BigInt(buf[i]!)
    }
    return result
}

export function toBufferLE(value: bigint, length: number): Buffer {
    const buf = Buffer.alloc(length)
    let v = value
    for (let i = 0; i < length; i++) {
        buf[i] = Number(v & 0xffn)
        v >>= 8n
    }
    return buf
}

export function toBufferBE(value: bigint, length: number): Buffer {
    const buf = Buffer.alloc(length)
    let v = value
    for (let i = length - 1; i >= 0; i--) {
        buf[i] = Number(v & 0xffn)
        v >>= 8n
    }
    return buf
}

export function xorBuffers(a: Buffer, b: Buffer): Buffer {
    const len = Math.min(a.length, b.length)
    const res = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) res[i] = a[i]! ^ b[i]!
    return res
}
