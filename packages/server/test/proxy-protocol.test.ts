import { describe, it, expect, afterEach } from 'vitest'
import { connect, type Socket } from 'node:net'
import { parseProxyHeader } from '../src/transport/proxy-protocol.js'
import { MtprotoTcpServer } from '../src/transport/tcp-server.js'
import { Connection } from '../src/transport/connection.js'

// --- parseProxyHeader unit tests -------------------------------------------

const V2_SIG = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a])

/** Build a PROXY v2 header (+ optional trailing payload). */
function v2(verCmd: number, famProto: number, addr: Buffer, trailer = Buffer.alloc(0)): Buffer {
    const head = Buffer.alloc(4)
    head[0] = verCmd
    head[1] = famProto
    head.writeUInt16BE(addr.length, 2)
    return Buffer.concat([V2_SIG, head, addr, trailer])
}

describe('parseProxyHeader — v1 (text)', () => {
    it('parses TCP4 and reports the source IP + consumed length', () => {
        const buf = Buffer.from('PROXY TCP4 203.0.113.7 198.51.100.1 51000 8082\r\nMTPROTO')
        const res = parseProxyHeader(buf)
        expect(res).toMatchObject({ status: 'done', sourceIp: '203.0.113.7' })
        if (res.status === 'done') expect(buf.subarray(res.consumed).toString()).toBe('MTPROTO')
    })

    it('parses TCP6', () => {
        const res = parseProxyHeader(Buffer.from('PROXY TCP6 2001:db8::1 2001:db8::2 5 6\r\n'))
        expect(res).toMatchObject({ status: 'done', sourceIp: '2001:db8::1' })
    })

    it('UNKNOWN has no source IP but is still consumed', () => {
        const buf = Buffer.from('PROXY UNKNOWN\r\nrest')
        const res = parseProxyHeader(buf)
        expect(res.status).toBe('done')
        if (res.status === 'done') {
            expect(res.sourceIp).toBeUndefined()
            expect(buf.subarray(res.consumed).toString()).toBe('rest')
        }
    })

    it('is incomplete until the CRLF arrives', () => {
        expect(parseProxyHeader(Buffer.from('PROXY TCP4 203.0.113.7 ')).status).toBe('incomplete')
    })
})

describe('parseProxyHeader — v2 (binary)', () => {
    it('parses an AF_INET PROXY header', () => {
        const addr = Buffer.from([192, 0, 2, 7, 198, 51, 100, 1, 0xc8, 0x38, 0x1f, 0x92])
        const res = parseProxyHeader(v2(0x21, 0x11, addr, Buffer.from('xy')))
        expect(res).toMatchObject({ status: 'done', sourceIp: '192.0.2.7' })
        if (res.status === 'done') expect(res.consumed).toBe(16 + 12)
    })

    it('parses an AF_INET6 PROXY header (compressed)', () => {
        const addr = Buffer.alloc(36)
        // src = 2001:db8::1
        addr[0] = 0x20
        addr[1] = 0x01
        addr[2] = 0x0d
        addr[3] = 0xb8
        addr[15] = 0x01
        const res = parseProxyHeader(v2(0x21, 0x21, addr))
        expect(res).toMatchObject({ status: 'done', sourceIp: '2001:db8::1' })
    })

    it('LOCAL command (health check) yields no source IP', () => {
        const res = parseProxyHeader(v2(0x20, 0x00, Buffer.alloc(0)))
        expect(res.status).toBe('done')
        if (res.status === 'done') expect(res.sourceIp).toBeUndefined()
    })

    it('is incomplete until the address block arrives', () => {
        const addr = Buffer.from([192, 0, 2, 7, 198, 51, 100, 1, 0, 0, 0, 0])
        const full = v2(0x21, 0x11, addr)
        expect(parseProxyHeader(full.subarray(0, 20)).status).toBe('incomplete')
    })
})

describe('parseProxyHeader — absent', () => {
    it('treats an MTProto abridged stream (0xef…) as absent', () => {
        expect(parseProxyHeader(Buffer.from([0xef, 0x01, 0xde, 0xad, 0xbe, 0xef])).status).toBe('absent')
    })

    it('treats a "P…" stream that is not "PROXY " as absent', () => {
        expect(parseProxyHeader(Buffer.from('POST / HTTP/1.1\r\n')).status).toBe('absent')
    })
})

// --- TCP carrier integration -----------------------------------------------

describe('MtprotoTcpServer with trustProxy', () => {
    let server: MtprotoTcpServer | undefined
    let client: Socket | undefined
    afterEach(() => {
        client?.destroy()
        server?.close()
    })

    it('strips the PROXY header, records the client IP, and forwards the stream', async () => {
        let conn: Connection | undefined
        const packets: Buffer[] = []
        const gotPacket = new Promise<void>(resolve => {
            server = new MtprotoTcpServer(
                { port: 0, defaultLayer: 204, trustProxy: true },
                {
                    onConnect: c => {
                        conn = c
                    },
                    onPacket: (p: Buffer) => {
                        packets.push(p)
                        resolve()
                    },
                },
            )
        })
        await server!.listen()

        await new Promise<void>((resolve, reject) => {
            client = connect(server!.port, '127.0.0.1', () => {
                // PROXY v1 header, then one abridged-framed 4-byte packet (0xef tag, len/4=1).
                client!.write('PROXY TCP4 203.0.113.7 198.51.100.1 51000 8082\r\n')
                client!.write(Buffer.from([0xef, 0x01, 0xde, 0xad, 0xbe, 0xef]))
                resolve()
            })
            client!.once('error', reject)
        })

        await gotPacket
        expect(conn?.ctx.remoteAddress).toBe('203.0.113.7')
        expect(packets).toHaveLength(1)
        expect(packets[0]!.toString('hex')).toBe('deadbeef')
    })
})
