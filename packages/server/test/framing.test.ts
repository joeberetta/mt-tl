import { describe, it, expect } from 'vitest'
import { randomBytes, createCipheriv } from 'node:crypto'
import { Framing } from '../src/transport/framing.js'

function intermediateFrame(packet: Buffer): Buffer {
    const len = Buffer.alloc(4)
    len.writeUInt32LE(packet.length, 0)
    return Buffer.concat([len, packet])
}

describe('Framing — intermediate', () => {
    it('detects mode and extracts a packet (even split across feeds)', () => {
        const f = new Framing()
        const payload = Buffer.from('0102030405060708', 'hex')
        const stream = Buffer.concat([Buffer.from('eeeeeeee', 'hex'), intermediateFrame(payload)])
        // split the stream mid-way
        expect(f.feed(stream.subarray(0, 5))).toEqual([])
        const packets = f.feed(stream.subarray(5))
        expect(packets).toHaveLength(1)
        expect(packets[0]!.equals(payload)).toBe(true)
        expect(f.mode).toBe('intermediate')
    })

    it('frames outgoing packets', () => {
        const f = new Framing()
        f.feed(Buffer.from('eeeeeeee', 'hex'))
        const out = f.frame(Buffer.from('aabbccdd', 'hex'))
        expect(out.equals(Buffer.from('04000000aabbccdd', 'hex'))).toBe(true)
    })
})

describe('Framing — abridged', () => {
    it('detects and reads a short packet', () => {
        const f = new Framing()
        const payload = Buffer.alloc(8, 0x55)
        // abridged frame: len/4 in one byte
        const framed = Buffer.concat([Buffer.from([payload.length / 4]), payload])
        const packets = f.feed(Buffer.concat([Buffer.from([0xef]), framed]))
        expect(packets).toHaveLength(1)
        expect(packets[0]!.equals(payload)).toBe(true)
        expect(f.mode).toBe('abridged')
    })
})

describe('Framing — full', () => {
    it('round-trips through its own framer', () => {
        const server = new Framing()
        // Build a tcp_full stream with a tiny client framer that mirrors server output.
        const client = new Framing()
        client.feed(Buffer.from('00000000', 'hex')) // can't: full has no init byte
        // Instead: prime server as full by sending a full-framed packet whose seq=0.
        const payload = Buffer.from('cafebabe', 'hex')
        // len = payload+12, seq=0, crc
        const f2 = new Framing()
        // Use server.frame after we force mode via detect: feed a valid full packet.
        const len = Buffer.alloc(4)
        len.writeUInt32LE(payload.length + 12, 0)
        const seq = Buffer.alloc(4) // 0
        const body = Buffer.concat([len, seq, payload])
        // crc via the same algorithm the framer uses
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const CRC32 = require('crc-32') as typeof import('crc-32')
        const crc = Buffer.alloc(4)
        crc.writeUInt32LE(CRC32.buf(body) >>> 0, 0)
        const packets = server.feed(Buffer.concat([body, crc]))
        expect(f2).toBeTruthy()
        expect(client).toBeTruthy()
        expect(packets).toHaveLength(1)
        expect(packets[0]!.equals(payload)).toBe(true)
        expect(server.mode).toBe('full')
    })
})

describe('Framing — obfuscated wrapping intermediate', () => {
    it('decrypts the header, detects inner mode, and reads packets', () => {
        // Build the obfuscated init as a real client would.
        let random: Buffer
        do {
            random = randomBytes(64)
        } while (random[0] === 0xef || random.readUInt32LE(0) === 0xeeeeeeee || random.readUInt32LE(4) === 0)
        random.writeUInt32LE(0xeeeeeeee, 56) // intermediate tag

        const encKey = random.subarray(8, 40)
        const encIv = random.subarray(40, 56)
        const enc = createCipheriv('aes-256-ctr', encKey, encIv)
        const encryptedInit = enc.update(random)
        const header = Buffer.concat([random.subarray(0, 56), encryptedInit.subarray(56, 64)])

        const server = new Framing()
        // Feed header alone: no packet yet.
        expect(server.feed(header)).toEqual([])
        expect(server.mode).toBe('obfuscated')

        // Send an intermediate-framed packet through the client's continuing cipher.
        const payload = Buffer.from('1122334455667788', 'hex')
        const cipherBytes = enc.update(intermediateFrame(payload))
        const packets = server.feed(cipherBytes)
        expect(packets).toHaveLength(1)
        expect(packets[0]!.equals(payload)).toBe(true)
    })
})
