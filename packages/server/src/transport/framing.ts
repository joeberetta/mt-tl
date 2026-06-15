import { createDecipheriv } from 'node:crypto'
import CRC32 from 'crc-32'
import { noopLogger, type Logger } from '@mt-tl/tl'
import { calculatePadding } from '../crypto/dh.js'

type Decipher = ReturnType<typeof createDecipheriv>

/**
 * MTProto transport framing. The same four modes the existing server supports
 * are delivered identically over TCP or inside binary WebSocket frames, so the
 * gateway feeds raw bytes here regardless of carrier.
 *
 * Modes: abridged (0xef), intermediate (0xeeeeeeee), full, and obfuscated
 * (a 64-byte AES-CTR header that wraps abridged/intermediate). Detection mirrors
 * `server.js` exactly for wire-compatibility.
 */
export type InnerMode = 'abridged' | 'intermediate' | 'full'
export type Mode = InnerMode | 'obfuscated'

function looksLikeTcpFullStreamStart(buf: Buffer): boolean {
    const len = buf.readUInt32LE(0)
    if (len > 65536 || buf.length < len) return false
    return buf.readUInt32LE(len - 8) === 0
}

export class Framing {
    mode?: Mode
    private inner?: InnerMode
    /** Plaintext queue from which inner packets are read. */
    private queue = Buffer.alloc(0)
    /** Pre-detection accumulation. */
    private detectBuf = Buffer.alloc(0)
    private sequenceIn = 0
    private sequenceOut = 0
    private decryptor?: Decipher
    private encryptor?: Decipher

    constructor(private readonly log: Logger = noopLogger) {}

    /** Feed received bytes; returns any complete packets that became available. */
    feed(chunk: Buffer): Buffer[] {
        if (this.mode === undefined) {
            this.detectBuf = Buffer.concat([this.detectBuf, chunk])
            if (!this.detect()) return []
        } else if (this.mode === 'obfuscated') {
            this.queue = Buffer.concat([this.queue, this.decryptor!.update(chunk)])
        } else {
            this.queue = Buffer.concat([this.queue, chunk])
        }
        return this.drain()
    }

    /** Frame an outgoing packet for the negotiated mode. */
    frame(packet: Buffer): Buffer {
        const eff = this.effectiveMode()
        const framed = this.frameInner(eff, packet)
        return this.mode === 'obfuscated' ? this.encryptor!.update(framed) : framed
    }

    private effectiveMode(): InnerMode {
        if (this.mode === 'obfuscated') return this.inner!
        return this.mode as InnerMode
    }

    private detect(): boolean {
        const buf = this.detectBuf
        if (buf.length < 4) return false

        if (buf.readUInt8(0) === 0xef) {
            this.mode = 'abridged'
            this.queue = Buffer.from(buf.subarray(1))
            return true
        }
        if (buf.readUInt32LE(0) === 0xeeeeeeee) {
            this.mode = 'intermediate'
            this.queue = Buffer.from(buf.subarray(4))
            return true
        }
        if (buf.length < 8) return false
        if (buf.readUInt32LE(4) === 0 || looksLikeTcpFullStreamStart(buf)) {
            this.mode = 'full'
            this.queue = Buffer.from(buf)
            return true
        }
        if (buf.length < 64) return false

        // Obfuscated: 64-byte header sets up AES-CTR streams.
        const header = Buffer.from(buf.subarray(0, 64))
        const rev = Buffer.from(header).reverse()
        this.decryptor = createDecipheriv('aes-256-ctr', header.subarray(8, 40), header.subarray(40, 56))
        this.encryptor = createDecipheriv('aes-256-ctr', rev.subarray(8, 40), rev.subarray(40, 56))
        const decHeader = this.decryptor.update(header)
        if (this.log.isLevelEnabled('trace')) {
            this.log.trace('framing.obfuscated', {
                tag: decHeader.subarray(56, 60).toString('hex'),
                rawHead: header.subarray(0, 16).toString('hex'),
                decHead: decHeader.subarray(0, 16).toString('hex'),
            })
        }
        switch (decHeader[56]) {
            case 0xdd:
            case 0xee:
                this.inner = 'intermediate'
                break
            case 0xef:
                this.inner = 'abridged'
                break
            default:
                throw new Error(
                    `obfuscated: cannot determine inner mode (tag ${decHeader.subarray(56, 60).toString('hex')})`,
                )
        }
        this.mode = 'obfuscated'
        this.queue = this.decryptor.update(Buffer.from(buf.subarray(64)))
        if (this.log.isLevelEnabled('trace')) {
            this.log.trace('framing.detected', {
                mode: this.mode,
                inner: this.inner,
                queued: this.queue.length,
            })
        }
        return true
    }

    private drain(): Buffer[] {
        const out: Buffer[] = []
        for (;;) {
            const p = this.readOne()
            if (p === undefined) break
            out.push(p)
        }
        return out
    }

    private readOne(): Buffer | undefined {
        switch (this.effectiveMode()) {
            case 'abridged':
                return this.readAbridged()
            case 'intermediate':
                return this.readIntermediate()
            case 'full':
                return this.readFull()
        }
    }

    private readAbridged(): Buffer | undefined {
        const q = this.queue
        if (q.length < 1) return undefined
        let len = q.readUInt8(0)
        let shift = 1
        if (len === 0x7f) {
            if (q.length < 4) return undefined
            len = (q.readUInt8(1) | (q.readUInt8(2) << 8) | (q.readUInt8(3) << 16)) << 2
            shift = 4
        } else {
            len <<= 2
        }
        if (q.length < len + shift) return undefined
        const packet = Buffer.from(q.subarray(shift, shift + len))
        this.queue = q.subarray(shift + len)
        return packet
    }

    private readIntermediate(): Buffer | undefined {
        const q = this.queue
        if (q.length < 4) return undefined
        const len = q.readUInt32LE(0)
        if (q.length < len + 4) return undefined
        const packet = Buffer.from(q.subarray(4, 4 + len))
        this.queue = q.subarray(4 + len)
        return packet
    }

    private readFull(): Buffer | undefined {
        // Standard tcp_full layout: [len(4)][seq(4)][payload][crc(4)], len = payload + 12.
        const q = this.queue
        if (q.length < 4) return undefined
        const len = q.readUInt32LE(0)
        if (len < 12 || q.length < len) return undefined
        const seqNo = q.readUInt32LE(4)
        if (seqNo !== this.sequenceIn) {
            throw new Error(`tcp_full: wrong sequence ${seqNo}, expected ${this.sequenceIn}`)
        }
        this.sequenceIn++
        const packet = Buffer.from(q.subarray(8, len - 4))
        this.queue = q.subarray(len)
        return packet
    }

    private frameInner(mode: InnerMode, packet: Buffer): Buffer {
        switch (mode) {
            case 'abridged': {
                const pad = Buffer.alloc(calculatePadding(packet.length, 4))
                const lenValue = (packet.length + pad.length) / 4
                const lenB =
                    lenValue < 127
                        ? Buffer.from([lenValue])
                        : Buffer.from([
                              0x7f,
                              lenValue & 0xff,
                              (lenValue >> 8) & 0xff,
                              (lenValue >> 16) & 0xff,
                          ])
                return Buffer.concat([lenB, packet, pad])
            }
            case 'intermediate': {
                const lenB = Buffer.alloc(4)
                lenB.writeUInt32LE(packet.length, 0)
                return Buffer.concat([lenB, packet])
            }
            case 'full': {
                const lenB = Buffer.alloc(4)
                lenB.writeUInt32LE(packet.length + 12, 0)
                const seqB = Buffer.alloc(4)
                seqB.writeUInt32LE(this.sequenceOut++, 0)
                const body = Buffer.concat([lenB, seqB, packet])
                const crc = Buffer.alloc(4)
                crc.writeUInt32LE(CRC32.buf(body) >>> 0, 0)
                return Buffer.concat([body, crc])
            }
        }
    }
}
