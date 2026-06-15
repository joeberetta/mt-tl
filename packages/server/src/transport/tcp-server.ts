import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'
import { noopLogger } from '@mt-tl/tl'
import { Connection } from './connection.js'
import { pump, type TransportHandlers, type TransportOptions } from './server-common.js'
import { parseProxyHeader } from './proxy-protocol.js'

/**
 * Raw TCP carrier for MTProto, for legacy clients that connect over a plain
 * socket rather than WebSocket. The byte stream is fed into the same framing as
 * WS (the framer already reassembles packets across `data` events), so abridged
 * / intermediate / full / obfuscated transports all work identically here.
 */
export class MtprotoTcpServer {
    private server?: Server
    private lastId = 0

    constructor(
        private readonly options: TransportOptions,
        private readonly handlers: TransportHandlers,
    ) {}

    listen(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = createServer({ allowHalfOpen: false }, socket => this.onConnection(socket))
            this.server.once('error', reject)
            this.server.listen(this.options.port, () => resolve())
        })
    }

    get port(): number {
        const addr = this.server?.address()
        return addr && typeof addr === 'object' ? (addr as AddressInfo).port : this.options.port
    }

    private onConnection(socket: Socket): void {
        socket.setNoDelay(true)
        const id = ++this.lastId

        const log = (this.options.logger ?? noopLogger).child({ scope: 'tcp', conn: id })
        log.info('conn.open', { remote: socket.remoteAddress })

        const conn = new Connection(
            id,
            bytes => {
                try {
                    socket.write(bytes)
                } catch {
                    conn.close()
                }
            },
            () => socket.destroy(),
            socket.remoteAddress,
            this.options.defaultLayer,
            log,
        )

        this.handlers.onConnect?.(conn)
        socket.on(
            'data',
            this.options.trustProxy ? this.proxyAware(conn) : chunk => pump(conn, chunk, this.handlers),
        )
        socket.on('close', () => {
            log.info('conn.close')
            conn.closed = true
            this.handlers.onClose?.(conn)
        })
        socket.on('error', err => {
            log.warn('tcp.error', { err: String(err) })
            conn.close()
        })
    }

    /**
     * Data handler that strips a leading PROXY-protocol header (when present)
     * before the byte stream reaches framing, recording the announced client IP
     * on the connection. Once the header is consumed (or shown absent), all
     * further bytes pass straight to `pump`.
     */
    private proxyAware(conn: Connection): (chunk: Buffer) => void {
        let header: Buffer | null = Buffer.alloc(0)
        return (chunk: Buffer) => {
            if (header === null) return pump(conn, chunk, this.handlers)
            header = header.length ? Buffer.concat([header, chunk]) : chunk
            const res = parseProxyHeader(header)
            if (res.status === 'incomplete') return
            const buffered = header
            header = null // done parsing; subsequent chunks bypass this path
            if (res.status === 'done') {
                if (res.sourceIp) conn.ctx.remoteAddress = res.sourceIp
                const rest = buffered.subarray(res.consumed)
                if (rest.length) pump(conn, rest, this.handlers)
            } else {
                // No PROXY header — the bytes are the MTProto stream itself.
                pump(conn, buffered, this.handlers)
            }
        }
    }

    close(): void {
        this.server?.close()
    }
}
