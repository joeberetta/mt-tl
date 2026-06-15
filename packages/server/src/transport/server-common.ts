import type { Logger } from '@mt-tl/tl'
import type { Connection } from './connection.js'

export type PacketHandler = (packet: Buffer, conn: Connection) => void | Promise<void>

export interface TransportHandlers {
    onPacket: PacketHandler
    onConnect?: (conn: Connection) => void
    onClose?: (conn: Connection) => void
}

export interface TransportOptions {
    port: number
    defaultLayer: number
    /**
     * Trust an upstream proxy for the client address: parse the PROXY-protocol
     * header on raw TCP, and trust `X-Forwarded-For` on WebSocket. Leave off
     * (default) when clients connect directly — the headers are spoofable.
     */
    trustProxy?: boolean
    /** Structured logger; the carrier derives a per-connection child from it. */
    logger?: Logger
}

/**
 * Feed a received byte chunk into a connection's framing and enqueue any
 * complete packets. Shared by the WebSocket and raw-TCP carriers — both deliver
 * bytes (WS as binary frames, TCP as a stream) to the same stateful framer.
 */
export function pump(conn: Connection, chunk: Buffer, handlers: TransportHandlers): void {
    let packets: Buffer[]
    try {
        packets = conn.framing.feed(chunk)
    } catch (err) {
        // Unframable bytes = a broken/hostile client; drop the connection. Expected
        // enough to be a warn, not an error (no server fault).
        conn.log.warn('framing.error', { err: String(err) })
        conn.close()
        return
    }
    if (packets.length && conn.log.isLevelEnabled('trace')) {
        conn.log.trace('framing.packets', {
            packets: packets.map(p => ({ bytes: p.length, head: p.subarray(0, 8).toString('hex') })),
        })
    }
    for (const packet of packets) {
        conn.enqueue(() => handlers.onPacket(packet, conn))
    }
}
