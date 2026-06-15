import { randomBytes } from 'node:crypto'
import { toBigIntBE } from '../util/bytes.js'

/**
 * Diffie-Hellman parameters and helpers for the auth-key exchange.
 * The 2048-bit prime and generator are the exact values the existing server
 * uses (`libs/mtproto-tools`), required for wire-compatibility.
 */
export const DH_PRIME = Buffer.from(
    'C71CAEB9C6B1C9048E6C522F70F13F73980D40238E3E21C14934D037563D930F' +
        '48198A0AA7C14058229493D22530F4DBFA336F6E0AC925139543AED44CCE7C37' +
        '20FD51F69458705AC68CD4FE6B6B13ABDC9746512969328454F18FAF8C595F64' +
        '2477FE96BB2A941D5BCD1D4AC8CC49880708FA9B378E3C4F3A9060BEE67CF9A4' +
        'A4A695811051907E162753B56B0F6B410DBA74D8A84B2A14B3144E0EF1284754' +
        'FD17ED950D5965B4B9DD46582DB1178D169C6BC465B0D6FF9CA3928FEF5B9AE4' +
        'E418FC15E83EBEA0F87FA9FF5EED70050DED2849F47BF959D956850CE929851F' +
        '0D8115F635B105EE2E4E15D04B2454BF6F4FADF034B10403119CD8E3B92FCC5B',
    'hex',
)
export const DH_PRIME_BIGINT = toBigIntBE(DH_PRIME)
export const DH_G = 3

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let result = 1n
    let b = base % mod
    let e = exp
    while (e > 0n) {
        if (e & 1n) result = (result * b) % mod
        e >>= 1n
        b = (b * b) % mod
    }
    return result
}

/** MTProto padding: smallest r >= 0 with (a + r) divisible by b. */
export function calculatePadding(a: number, b: number, min = 0): number {
    let r = -a % b
    while (r < 0 || (min && r < min)) r += b
    return r + 0 // normalize -0 -> 0
}

// --- p, q factorization proof-of-work --------------------------------------

const MAX_INT = 0x7fffffffn
const MAX_LONG = 0x7fffffffffffffffn
const MR_WITNESSES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]

function isProbablePrime(n: bigint): boolean {
    if (n < 2n) return false
    for (const p of MR_WITNESSES) {
        if (n === p) return true
        if (n % p === 0n) return false
    }
    let d = n - 1n
    let r = 0n
    while ((d & 1n) === 0n) {
        d >>= 1n
        r++
    }
    for (const a of MR_WITNESSES) {
        let x = modPow(a, d, n)
        if (x === 1n || x === n - 1n) continue
        let composite = true
        for (let i = 0n; i < r - 1n; i++) {
            x = (x * x) % n
            if (x === n - 1n) {
                composite = false
                break
            }
        }
        if (composite) return false
    }
    return true
}

function randomPrime31(): bigint {
    for (;;) {
        let n = BigInt(randomBytes(4).readUInt32BE(0) & 0x7fffffff)
        n |= 1n
        if (n < 3n || n > MAX_INT) continue
        if (isProbablePrime(n)) return n
    }
}

/**
 * Returns [p, q, pq] where p < q are ~31-bit primes and pq = p*q fits in a
 * signed 64-bit long. Mirrors the existing server's `makePQ`.
 */
export function makePQ(): { p: bigint; q: bigint; pq: Buffer } {
    let a: bigint
    let b: bigint
    let ab: bigint
    do {
        a = randomPrime31()
        b = randomPrime31()
        ab = a * b
    } while (a > MAX_INT || b > MAX_INT || ab > MAX_LONG)

    const pq = Buffer.from(ab.toString(16).padStart(16, '0'), 'hex')
    return a < b ? { p: a, q: b, pq } : { p: b, q: a, pq }
}
