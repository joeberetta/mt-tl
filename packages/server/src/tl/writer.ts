import { toBufferLE } from '../util/bytes.js'
import { BOOL_FALSE_ID, BOOL_TRUE_ID } from './reader.js'

/**
 * Low-level writer for the TL wire format. Grows its backing buffer in 1 KiB
 * steps. Ported from the existing `protocolBuffer.js`.
 */
export class TlWriter {
    private buf: Buffer
    private pos = 0
    private readonly step = 1024

    constructor(preallocate = 1024) {
        this.buf = Buffer.allocUnsafe(preallocate)
    }

    private alloc(len: number): void {
        if (this.buf.length >= this.pos + len) return
        let target = this.buf.length + this.step
        while (target < this.pos + len) target += this.step
        const next = Buffer.allocUnsafe(target)
        this.buf.copy(next, 0, 0, this.pos)
        this.buf = next
    }

    writeRaw(val: Buffer, len = val.length): this {
        this.alloc(len)
        val.copy(this.buf, this.pos, 0, len)
        this.pos += len
        return this
    }

    writeUInt8(val: number): this {
        this.alloc(1)
        this.buf.writeUInt8(val & 0xff, this.pos++)
        return this
    }

    writeUInt32(val: number): this {
        this.alloc(4)
        this.buf.writeUInt32LE(val >>> 0, this.pos)
        this.pos += 4
        return this
    }

    writeInt32(val: number): this {
        this.alloc(4)
        this.buf.writeInt32LE(val | 0, this.pos)
        this.pos += 4
        return this
    }

    writeLong(val: bigint): this {
        return this.writeRaw(toBufferLE(BigInt(val), 8), 8)
    }

    writeDouble(val: number): this {
        this.alloc(8)
        this.buf.writeDoubleLE(val, this.pos)
        this.pos += 8
        return this
    }

    /** 16/32 raw bytes for int128/int256 (left-padded if a short buffer is given). */
    writeFixed(val: Buffer, len: number): this {
        if (val.length === len) return this.writeRaw(val, len)
        const padded = Buffer.alloc(len)
        val.copy(padded, len - val.length)
        return this.writeRaw(padded, len)
    }

    writeBytes(val: Buffer): this {
        let len: number
        if (val.length < 254) {
            this.writeUInt8(val.length)
            len = 1
        } else {
            // 0xfe marker + 3-byte LE length
            this.writeUInt8(254)
            this.writeUInt32(val.length)
            this.pos--
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
        return this.writeBytes(val ? Buffer.from(val, 'utf-8') : Buffer.alloc(0))
    }

    writeBool(val: boolean): this {
        return this.writeUInt32(val ? BOOL_TRUE_ID : BOOL_FALSE_ID)
    }

    toBuffer(): Buffer {
        return Buffer.from(this.buf.subarray(0, this.pos))
    }
}
