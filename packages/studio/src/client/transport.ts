// Browser WebSocket transport for the MTProto client. Native `WebSocket` with
// binary frames (Uint8Array), mirroring @mt-tl/testing's `wsTransport` (which
// uses the node `ws` package). The MTProto length-framing lives in the client.

import { createCtr, randomBytes } from './crypto.js'

export interface ClientTransport {
    connect(): Promise<void>
    send(bytes: Uint8Array): void
    onData(cb: (chunk: Uint8Array) => void): void
    /** Notified when the underlying socket closes (server drop / network loss). */
    onClose?(cb: () => void): void
    close(): void
}

export function wsTransport(url: string): ClientTransport {
    let ws: WebSocket
    let onData: (chunk: Uint8Array) => void = () => {}
    let onClose: () => void = () => {}
    let opened = false
    return {
        connect: () =>
            new Promise((resolve, reject) => {
                ws = new WebSocket(url)
                ws.binaryType = 'arraybuffer'
                ws.onopen = () => {
                    opened = true
                    resolve()
                }
                ws.onerror = () => reject(new Error(`WebSocket error connecting to ${url}`))
                ws.onmessage = ev => {
                    const data = ev.data
                    if (data instanceof ArrayBuffer) onData(new Uint8Array(data))
                    else if (data instanceof Uint8Array) onData(data)
                    // text frames are not part of the protocol — ignore
                }
                // onclose reads the `onClose` var at fire time, so registering it
                // after connect() (post-open) still works.
                ws.onclose = () => {
                    if (opened) onClose()
                }
            }),
        send: bytes => ws.send(bytes),
        onData: cb => (onData = cb),
        onClose: cb => (onClose = cb),
        close: () => ws.close(),
    }
}

// Protocol identifier for the intermediate transport (sent as init[56:60] when
// obfuscated, instead of the standalone 0xeeeeeeee header on the first packet).
const INTERMEDIATE_ID = 0xee
// First-int values that must not appear at init[0:4] (they collide with other
// transports / HTTP verbs). Read little-endian. See the obfuscation spec.
const FORBIDDEN_FIRST_INT = new Set([0x44414548, 0x54534f50, 0x20544547, 0x4954504f, 0x02010316, 0xdddddddd, 0xeeeeeeee])

interface Obfuscation {
    encrypt: (d: Uint8Array) => Uint8Array
    decrypt: (d: Uint8Array) => Uint8Array
    /** The 64-byte payload to send first (plaintext prefix + encrypted tail). */
    finalInit: Uint8Array
}

/** Build the MTProto obfuscated-transport init (64-byte payload + the two CTR ciphers). */
function makeObfuscation(): Obfuscation {
    let init: Uint8Array
    for (;;) {
        init = randomBytes(64)
        if (init[0] === 0xef) continue
        const dv = new DataView(init.buffer, init.byteOffset, 8)
        if (FORBIDDEN_FIRST_INT.has(dv.getUint32(0, true))) continue
        if (dv.getUint32(4, true) === 0) continue // would signal the "full" transport (TCP seq 0)
        break
    }
    // Declare the intermediate transport at offset 56 (the standalone header is then omitted).
    init[56] = init[57] = init[58] = init[59] = INTERMEDIATE_ID
    // Encryption key/iv from the primary payload; decryption from its reverse.
    const encrypt = createCtr(init.slice(8, 40), init.slice(40, 56))
    const rev = init.slice().reverse()
    const decrypt = createCtr(rev.slice(8, 40), rev.slice(40, 56))
    // Encrypt the whole init through the REAL encrypt cipher (advancing it to offset 64),
    // then splice the encrypted bytes 56:64 back over the plaintext-prefix init.
    const encInit = encrypt(init)
    const finalInit = init.slice()
    finalInit.set(encInit.subarray(56, 64), 56)
    return { encrypt, decrypt, finalInit }
}

/**
 * Obfuscated WebSocket transport — required to talk to real Telegram (and any
 * MTProxy-style server) over WS. Opens with the mandatory `Sec-WebSocket-Protocol:
 * binary` subprotocol, sends the 64-byte obfuscation init on open, then AES-256-CTR
 * encrypts every outgoing chunk / decrypts every incoming one with continuous
 * ciphers. The intermediate framing the client writes rides inside this stream.
 */
export function obfuscatedWsTransport(url: string): ClientTransport {
    let ws: WebSocket
    let onData: (chunk: Uint8Array) => void = () => {}
    let onClose: () => void = () => {}
    let opened = false
    let obf: Obfuscation
    return {
        connect: () =>
            new Promise((resolve, reject) => {
                // The `binary` subprotocol sets the required Sec-WebSocket-Protocol header.
                ws = new WebSocket(url, 'binary')
                ws.binaryType = 'arraybuffer'
                ws.onopen = () => {
                    obf = makeObfuscation()
                    ws.send(obf.finalInit) // the init is sent UNobfuscated (it carries the keys)
                    opened = true
                    resolve()
                }
                ws.onerror = () => reject(new Error(`WebSocket error connecting to ${url}`))
                ws.onmessage = ev => {
                    const data = ev.data
                    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
                    if (bytes instanceof Uint8Array) onData(obf.decrypt(bytes))
                }
                ws.onclose = () => {
                    if (opened) onClose()
                }
            }),
        send: bytes => ws.send(obf.encrypt(bytes)),
        onData: cb => (onData = cb),
        onClose: cb => (onClose = cb),
        close: () => ws.close(),
    }
}
