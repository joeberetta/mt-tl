import { toBytesLE } from './bytes.js'
import { BOOL_FALSE_ID, BOOL_TRUE_ID } from './reader.js'

const te = new TextEncoder()

/**
 * Browser TL wire writer (Uint8Array + DataView), byte-identical to
 * @mt-tl/server's TlWriter. Grows its backing buffer in 1 KiB steps.
 */
export class TlWriter {
    private buf: Uint8Array
    private view: DataView
    private pos = 0
    private readonly step = 1024

    constructor(preallocate = 1024) {
        this.buf = new Uint8Array(preallocate)
        this.view = new DataView(this.buf.buffer)
    }

    private alloc(len: number): void {
        if (this.buf.length >= this.pos + len) return
        let target = this.buf.length + this.step
        while (target < this.pos + len) target += this.step
        const next = new Uint8Array(target)
        next.set(this.buf.subarray(0, this.pos))
        this.buf = next
        this.view = new DataView(next.buffer)
    }

    writeRaw(val: Uint8Array, len = val.length): this {
        this.alloc(len)
        this.buf.set(len === val.length ? val : val.subarray(0, len), this.pos)
        this.pos += len
        return this
    }

    writeUInt8(val: number): this {
        this.alloc(1)
        this.view.setUint8(this.pos++, val & 0xff)
        return this
    }

    writeUInt32(val: number): this {
        this.alloc(4)
        this.view.setUint32(this.pos, val >>> 0, true)
        this.pos += 4
        return this
    }

    writeInt32(val: number): this {
        this.alloc(4)
        this.view.setInt32(this.pos, val | 0, true)
        this.pos += 4
        return this
    }

    writeLong(val: bigint): this {
        return this.writeRaw(toBytesLE(BigInt(val), 8), 8)
    }

    writeDouble(val: number): this {
        this.alloc(8)
        this.view.setFloat64(this.pos, val, true)
        this.pos += 8
        return this
    }

    /** 16/32 raw bytes for int128/int256 (left-padded if a short buffer is given). */
    writeFixed(val: Uint8Array, len: number): this {
        if (val.length === len) return this.writeRaw(val, len)
        const padded = new Uint8Array(len)
        padded.set(val, len - val.length)
        return this.writeRaw(padded, len)
    }

    writeBytes(val: Uint8Array): this {
        let len: number
        if (val.length < 254) {
            this.writeUInt8(val.length)
            len = 1
        } else {
            // 0xfe marker + 3-byte LE length
            this.writeUInt8(254)
            this.writeUInt8(val.length & 0xff)
            this.writeUInt8((val.length >>> 8) & 0xff)
            this.writeUInt8((val.length >>> 16) & 0xff)
            len = 4
        }
        this.writeRaw(val)
        len += val.length
        while (len % 4 !== 0) {
            this.writeUInt8(0)
            len++
        }
        return this
    }

    writeString(val: string): this {
        return this.writeBytes(val ? te.encode(val) : new Uint8Array(0))
    }

    writeBool(val: boolean): this {
        return this.writeUInt32(val ? BOOL_TRUE_ID : BOOL_FALSE_ID)
    }

    toBytes(): Uint8Array {
        return this.buf.slice(0, this.pos)
    }
}
