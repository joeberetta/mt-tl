/** In-flight auth-key-exchange state, keyed by the client nonce (hex). */
export interface NonceData {
    clientNonce: Buffer
    serverNonce: Buffer
    newClientNonce?: Buffer
    p?: bigint
    q?: bigint
    pq?: Buffer
    /** server DH secret exponent */
    a?: bigint
    tmpAesKey?: Buffer
    tmpAesIv?: Buffer
    expiresIn?: number | false
    timer?: NodeJS.Timeout
}

const TTL_MS = 10 * 60 * 1000 // 10 minutes (Telegram drops stale handshakes)

export class NonceStore {
    private map = new Map<string, NonceData>()

    set(nonceHex: string, data: NonceData): void {
        const existing = this.map.get(nonceHex)
        if (existing?.timer) clearTimeout(existing.timer)
        data.timer = setTimeout(() => this.map.delete(nonceHex), TTL_MS)
        if (typeof data.timer.unref === 'function') data.timer.unref()
        this.map.set(nonceHex, data)
    }

    get(nonceHex: string): NonceData | undefined {
        return this.map.get(nonceHex)
    }

    delete(nonceHex: string): void {
        const existing = this.map.get(nonceHex)
        if (existing?.timer) clearTimeout(existing.timer)
        this.map.delete(nonceHex)
    }
}
