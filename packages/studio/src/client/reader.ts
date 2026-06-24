import { toBigIntLE } from './bytes.js'

export const BOOL_TRUE_ID = 0x997275b5
export const BOOL_FALSE_ID = 0xbc799737
export const VECTOR_ID = 0x1cb5c415

const td = new TextDecoder()

/**
 * Browser TL wire reader (Uint8Array + DataView), byte-identical to
 * @mt-tl/server's TlReader. Same little-endian / 4-byte `bytes` padding rules.
 */
export class TlReader {
    private pos = 0
    private readonly view: DataView

    constructor(private readonly buf: Uint8Array) {
        this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    }

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

    /** A view into the backing buffer (no copy) — matches the node reader's `read`. */
    read(len: number): Uint8Array {
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
        return this.view.getUint8(this.pos++)
    }

    readUInt32(): number {
        this.expect(4)
        const v = this.view.getUint32(this.pos, true)
        this.pos += 4
        return v
    }

    readInt32(): number {
        this.expect(4)
        const v = this.view.getInt32(this.pos, true)
        this.pos += 4
        return v
    }

    readLong(): bigint {
        return toBigIntLE(this.read(8))
    }

    readDouble(): number {
        this.expect(8)
        const v = this.view.getFloat64(this.pos, true)
        this.pos += 8
        return v
    }

    readInt128(): Uint8Array {
        return this.read(16).slice()
    }

    readInt256(): Uint8Array {
        return this.read(32).slice()
    }

    /** TL `bytes`/`string` — length-prefixed with 4-byte alignment padding. */
    readBytes(): Uint8Array {
        let extra = 1
        let len = this.readUInt8()
        if (len >= 254) {
            len = this.readUInt8() + this.readUInt8() * 256 + this.readUInt8() * 65536
            extra = 4
        }
        const out = this.read(len).slice()
        const rem = (len + extra) % 4
        if (rem > 0) this.skip(4 - rem)
        return out
    }

    readString(): string {
        return td.decode(this.readBytes())
    }
}
