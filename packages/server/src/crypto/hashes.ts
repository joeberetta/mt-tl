import { createHash, randomBytes } from 'node:crypto'
import { toBigIntBE } from '../util/bytes.js'

export { xorBuffers } from '../util/bytes.js'

export function sha1(buf: Buffer): Buffer {
    return createHash('sha1').update(buf).digest()
}

export function sha256(buf: Buffer): Buffer {
    return createHash('sha256').update(buf).digest()
}

/** Cryptographically-random bigint of the given bit width (multiple of 8). */
export function randomBigInt(bits: number): bigint {
    return toBigIntBE(randomBytes(bits / 8))
}
