// PROXY protocol (HAProxy) header parsing for the raw-TCP carrier. When a TCP
// load balancer / proxy sits in front, it prepends a small header announcing the
// real client address before the MTProto byte stream. We parse it (v1 text and
// v2 binary) so `RpcContext.ip` reflects the client, not the proxy. Only used
// when `trustProxy` is set — the spec assumes a trusted proxy always prepends it.
// Ref: https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt

/** 12-byte v2 signature: `\r\n\r\n\0\r\nQUIT\n`. */
const V2_SIG = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a])
/** v1 lines start with `PROXY ` and are at most 107 bytes incl. CRLF. */
const V1_PREFIX = Buffer.from('PROXY ')
const V1_MAX = 107
/** Cap buffered bytes while a header is still incomplete (guards a slow/malicious peer). */
const MAX_HEADER = 1024

export type ProxyParse =
    /** A complete header. `sourceIp` is undefined for UNKNOWN/LOCAL/UNSPEC (use the socket address). */
    | { status: 'done'; sourceIp?: string; consumed: number }
    /** Need more bytes — the buffer is a valid prefix of a header so far. */
    | { status: 'incomplete' }
    /** No PROXY header — treat the bytes as the start of the MTProto stream. */
    | { status: 'absent' }

/**
 * Inspects the start of a freshly-accepted TCP stream for a PROXY-protocol
 * header. Returns `done` (with the parsed source IP and how many bytes the header
 * occupied), `incomplete` (call again with more bytes), or `absent` (no header —
 * the bytes are the MTProto stream itself).
 */
export function parseProxyHeader(buf: Buffer): ProxyParse {
    if (buf.length === 0) return { status: 'incomplete' }
    const b0 = buf[0]!

    // v2 — binary, begins with 0x0D.
    if (b0 === 0x0d) {
        const n = Math.min(buf.length, V2_SIG.length)
        for (let i = 0; i < n; i++) if (buf[i] !== V2_SIG[i]) return { status: 'absent' }
        if (buf.length < 16) return buf.length > MAX_HEADER ? { status: 'absent' } : { status: 'incomplete' }
        return parseV2(buf)
    }

    // v1 — text, begins with 'P' (0x50) of "PROXY ".
    if (b0 === 0x50) {
        const crlf = buf.indexOf('\r\n')
        if (crlf === -1) {
            if (buf.length > V1_MAX) return { status: 'absent' }
            const n = Math.min(buf.length, V1_PREFIX.length)
            for (let i = 0; i < n; i++) if (buf[i] !== V1_PREFIX[i]) return { status: 'absent' }
            return { status: 'incomplete' }
        }
        return parseV1(buf.toString('latin1', 0, crlf), crlf + 2)
    }

    return { status: 'absent' }
}

function parseV1(line: string, consumed: number): ProxyParse {
    // "PROXY TCP4 <src> <dst> <srcPort> <dstPort>" | "PROXY UNKNOWN ..."
    const parts = line.split(' ')
    if (parts[0] !== 'PROXY') return { status: 'absent' }
    if (parts[1] === 'TCP4' || parts[1] === 'TCP6') return { status: 'done', sourceIp: parts[2], consumed }
    return { status: 'done', consumed } // UNKNOWN — no announced address
}

function parseV2(buf: Buffer): ProxyParse {
    const cmd = buf[12]! & 0x0f // 0 = LOCAL (health check), 1 = PROXY
    const family = buf[13]! >> 4 // 1 = AF_INET, 2 = AF_INET6
    const addrLen = buf.readUInt16BE(14)
    const total = 16 + addrLen
    if (buf.length < total) return total > MAX_HEADER ? { status: 'absent' } : { status: 'incomplete' }

    let sourceIp: string | undefined
    if (cmd === 0x1) {
        if (family === 0x1 && addrLen >= 12) {
            sourceIp = `${buf[16]}.${buf[17]}.${buf[18]}.${buf[19]}`
        } else if (family === 0x2 && addrLen >= 36) {
            sourceIp = formatIpv6(buf.subarray(16, 32))
        }
    }
    return { status: 'done', sourceIp, consumed: total }
}

/** 16 bytes → a compressed IPv6 string (longest run of zero groups → `::`). */
function formatIpv6(b: Buffer): string {
    const groups: number[] = []
    for (let i = 0; i < 16; i += 2) groups.push((b[i]! << 8) | b[i + 1]!)
    // Find the longest run of zero groups to compress.
    let bestStart = -1
    let bestLen = 0
    let curStart = -1
    let curLen = 0
    for (let i = 0; i < 8; i++) {
        if (groups[i] === 0) {
            if (curStart === -1) curStart = i
            curLen++
            if (curLen > bestLen) {
                bestLen = curLen
                bestStart = curStart
            }
        } else {
            curStart = -1
            curLen = 0
        }
    }
    if (bestLen < 2) return groups.map(g => g.toString(16)).join(':')
    const head = groups.slice(0, bestStart).map(g => g.toString(16))
    const tail = groups.slice(bestStart + bestLen).map(g => g.toString(16))
    return `${head.join(':')}::${tail.join(':')}`
}
