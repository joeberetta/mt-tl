import { WebSocket } from 'ws'
import { connect as netConnect, type Socket } from 'node:net'

// --- transports (WS frames or a TCP byte stream) ---------------------------

export interface ClientTransport {
    connect(): Promise<void>
    send(bytes: Buffer): void
    onData(cb: (chunk: Buffer) => void): void
    close(): void
}

export function wsTransport(url: string): ClientTransport {
    let ws: WebSocket
    let onData: (chunk: Buffer) => void = () => {}
    return {
        connect: () =>
            new Promise((resolve, reject) => {
                ws = new WebSocket(url)
                ws.binaryType = 'nodebuffer'
                ws.on('open', () => resolve())
                ws.on('error', reject)
                ws.on('message', (data: Buffer) => onData(data))
            }),
        send: bytes => ws.send(bytes, { binary: true }),
        onData: cb => (onData = cb),
        close: () => ws.close(),
    }
}

export function tcpTransport(port: number, host = '127.0.0.1'): ClientTransport {
    let socket: Socket
    let onData: (chunk: Buffer) => void = () => {}
    return {
        connect: () =>
            new Promise((resolve, reject) => {
                socket = netConnect({ host, port }, () => resolve())
                socket.on('error', reject)
                socket.on('data', chunk => onData(chunk))
            }),
        send: bytes => socket.write(bytes),
        onData: cb => (onData = cb),
        close: () => socket.destroy(),
    }
}
