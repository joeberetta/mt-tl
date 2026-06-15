import { sha256 } from './hashes.js'

/**
 * MTProto 2.0 message-key derivation. `outgoing` selects the key half
 * (server->client uses x=8). Ported from the existing `messageEncryption.js`;
 * pinned by a known-answer test.
 */
export function generateMessageKey(
    authKey: Buffer,
    msgKey: Buffer,
    outgoing: boolean,
): { aesKey: Buffer; aesIv: Buffer } {
    const x = outgoing ? 8 : 0
    const a = sha256(Buffer.concat([msgKey, authKey.subarray(x, x + 36)]))
    const b = sha256(Buffer.concat([authKey.subarray(x + 40, x + 76), msgKey]))
    return {
        aesKey: Buffer.concat([a.subarray(0, 8), b.subarray(8, 24), a.subarray(24, 32)]),
        aesIv: Buffer.concat([b.subarray(0, 8), a.subarray(8, 24), b.subarray(24, 32)]),
    }
}

/**
 * msg_key = SHA256(authKey[88+x : 88+x+32] ‖ plaintext)[8:24] (MTProto 2.0),
 * where x = 8 for server->client (outgoing) and x = 0 for client->server.
 */
export function computeMsgKey(authKey: Buffer, plaintext: Buffer, outgoing: boolean): Buffer {
    const x = outgoing ? 8 : 0
    return sha256(Buffer.concat([authKey.subarray(88 + x, 88 + x + 32), plaintext])).subarray(8, 24)
}
