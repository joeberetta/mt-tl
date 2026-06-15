import { toBigIntLE } from '../util/bytes.js'

export const BOOL_TRUE_ID = 0x997275b5
export const BOOL_FALSE_ID = 0xbc799737
export const VECTOR_ID = 0x1cb5c415

/**
 * Low-level reader for the TL wire format. Exposes only primitive reads; the
 * codec drives constructor-id dispatch, vectors and flags. Ported from the
 * existing `protocolBuffer.js` (same little-endian / padding rules).
 */
export class TlReader {
    private pos = 0

    constructor(private readonly buf: Buffer) {}

    get position(): number {
        return this.pos
    }

    get remaining(): number {
        return this.buf.length - this.pos
    }

    private expect(len: number): void {
        if (this.buf.length < this.pos + len) {
            throw new Error(`TL read out of bounds: need ${len}, have ${this.remaining}`)
        }
    }

    read(len: number): Buffer {
        this.expect(len)
        const out = this.buf.subarray(this.pos, this.pos + len)
        this.pos += len
        return out
    }

    skip(len: number): void {
        this.expect(len)
        this.pos += len
    }

    readUInt8(): number {
        this.expect(1)
        return this.buf.readUInt8(this.pos++)
    }

    readUInt32(): number {
        this.expect(4)
        const v = this.buf.readUInt32LE(this.pos)
        this.pos += 4
        return v
    }

    readInt32(): number {
        this.expect(4)
        const v = this.buf.readInt32LE(this.pos)
        this.pos += 4
        return v
    }

    /** TL `long` — 8 bytes LE, read as an unsigned bigint (matches existing server). */
    readLong(): bigint {
        return toBigIntLE(this.read(8))
    }

    readDouble(): number {
        this.expect(8)
        const v = this.buf.readDoubleLE(this.pos)
        this.pos += 8
        return v
    }

    readInt128(): Buffer {
        return Buffer.from(this.read(16))
    }

    readInt256(): Buffer {
        return Buffer.from(this.read(32))
    }

    /** TL `bytes`/`string` — length-prefixed with 4-byte alignment padding. */
    readBytes(): Buffer {
        let extra = 1
        let len = this.readUInt8()
        if (len >= 254) {
            len = this.readUInt8() + this.readUInt8() * 256 + this.readUInt8() * 65536
            extra = 4
        }
        const out = Buffer.from(this.read(len))
        const rem = (len + extra) % 4
        if (rem > 0) this.skip(4 - rem)
        return out
    }

    readString(): string {
        return this.readBytes().toString('utf-8')
    }
}
