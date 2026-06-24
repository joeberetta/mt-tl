// Pure BigInt <-> Uint8Array helpers (little/big endian) + concat/xor/hex.
// Browser mirror of @mt-tl/server's util/bytes.ts (values are unsigned), so the
// ported wire codec and client are byte-identical to the node engine.

export function toBigIntLE(b: Uint8Array): bigint {
    let r = 0n
    for (let i = b.length - 1; i >= 0; i--) r = (r << 8n) | BigInt(b[i]!)
    return r
}

export function toBigIntBE(b: Uint8Array): bigint {
    let r = 0n
    for (let i = 0; i < b.length; i++) r = (r << 8n) | BigInt(b[i]!)
    return r
}

export function toBytesLE(value: bigint, length: number): Uint8Array {
    const out = new Uint8Array(length)
    let v = value
    for (let i = 0; i < length; i++) {
        out[i] = Number(v & 0xffn)
        v >>= 8n
    }
    return out
}

export function toBytesBE(value: bigint, length: number): Uint8Array {
    const out = new Uint8Array(length)
    let v = value
    for (let i = length - 1; i >= 0; i--) {
        out[i] = Number(v & 0xffn)
        v >>= 8n
    }
    return out
}

export function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const len = Math.min(a.length, b.length)
    const out = new Uint8Array(len)
    for (let i = 0; i < len; i++) out[i] = a[i]! ^ b[i]!
    return out
}

export function concat(...arrs: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(arrs.reduce((a, x) => a + x.length, 0))
    let o = 0
    for (const a of arrs) {
        out.set(a, o)
        o += a.length
    }
    return out
}

export function hexToBytes(hex: string): Uint8Array {
    const clean = hex.length % 2 ? '0' + hex : hex
    const out = new Uint8Array(clean.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
    return out
}

/** Minimal big-endian byte form of a positive bigint (no leading zero), for `p`/`q`. */
export function bigIntToMinBytes(v: bigint): Uint8Array {
    let hex = v.toString(16)
    if (hex.length % 2) hex = '0' + hex
    return hexToBytes(hex)
}

/** Human form of a 64-bit msg_id: hex first (matches server logs), decimal in parens.
 *  e.g. `6a3b796253a00000 (7654845454863040512)`. */
export function fmtMsgId(id: bigint): string {
    return `${id.toString(16).padStart(16, '0')} (${id.toString()})`
}
