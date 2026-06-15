import { WebSocketServer, type WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage } from 'node:http'
import { noopLogger } from '@mt-tl/tl'
import { Connection } from './connection.js'
import { pump, type TransportHandlers, type TransportOptions } from './server-common.js'

export type { PacketHandler, TransportHandlers } from './server-common.js'

function toBuffer(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
    if (Buffer.isBuffer(data)) return data
    if (Array.isArray(data)) return Buffer.concat(data)
    return Buffer.from(data)
}

/**
 * WebSocket carrier for MTProto. Each binary frame is fed into the connection's
 * transport framing; complete packets are handed to `onPacket` in arrival order.
 */
export class MtprotoWsServer {
    private wss?: WebSocketServer
    private lastId = 0

    constructor(
        private readonly options: TransportOptions,
        private readonly handlers: TransportHandlers,
    ) {}

    listen(): Promise<void> {
        return new Promise(resolve => {
            this.wss = new WebSocketServer({ port: this.options.port, clientTracking: false })
            this.wss.on('connection', (socket, req) => this.onConnection(socket, req))
            this.wss.on('listening', () => resolve())
        })
    }

    /** Bound TCP port (useful when listening on port 0 in tests). */
    get port(): number {
        const addr = this.wss?.address()
        return addr && typeof addr === 'object' ? (addr as AddressInfo).port : this.options.port
    }

    private onConnection(socket: WebSocket, req: IncomingMessage): void {
        const id = ++this.lastId
        // Only trust the (spoofable) X-Forwarded-For when an upstream proxy is declared.
        const forwarded = this.options.trustProxy
            ? (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
            : undefined
        const remote = forwarded ?? req.socket.remoteAddress ?? undefined

        const log = (this.options.logger ?? noopLogger).child({ scope: 'ws', conn: id })
        log.info('conn.open', { remote })
        if (log.isLevelEnabled('trace')) {
            log.trace('ws.connect', {
                host: req.headers.host,
                xff: req.headers['x-forwarded-for'],
                proto: req.headers['sec-websocket-protocol'],
                ua: req.headers['user-agent'],
            })
        }

        const conn = new Connection(
            id,
            bytes => socket.send(bytes, { binary: true }),
            () => socket.close(),
            remote,
            this.options.defaultLayer,
            log,
        )

        this.handlers.onConnect?.(conn)
        socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
            const buf = toBuffer(data)
            if (log.isLevelEnabled('trace'))
                log.trace('ws.recv', { bytes: buf.length, head: buf.subarray(0, 16).toString('hex') })
            pump(conn, buf, this.handlers)
        })
        socket.on('close', (code, reason) => {
            log.info('conn.close', { code })
            if (reason?.length && log.isLevelEnabled('trace'))
                log.trace('ws.close', { reason: reason.toString() })
            conn.closed = true
            this.handlers.onClose?.(conn)
        })
        socket.on('error', err => {
            log.warn('ws.error', { err: String(err) })
            conn.close()
        })
    }

    close(): void {
        this.wss?.close()
    }
}
