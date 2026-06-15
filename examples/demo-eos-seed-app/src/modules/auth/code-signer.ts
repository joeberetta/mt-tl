import { randomBytes } from 'node:crypto'
import type { EccLib } from './ecc.js'

const CODE_TTL_SECONDS = 3600
const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const EOS_CHARSET = 'abcdefghijklmnopqrstuvwxyz12345'

function randomString(len: number, alphabet = ALPHANUMERIC): string {
    const bytes = randomBytes(len)
    let out = ''
    for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length]
    return out
}

/** A throwaway EOS-style account name (real chain registration is out of scope). */
export function generateEosName(): string {
    return 'c.' + randomString(10, EOS_CHARSET)
}

export interface IssuedCode {
    code: string
    serverSign: string
}

/**
 * Wraps the EOS signature scheme behind the auth code round-trip: the server
 * issues a signed code (sendCode), the client signs it back, and the server
 * verifies its own signature + recovers the client's public key (sign in/up).
 */
export class CodeSigner {
    constructor(
        private readonly ecc: EccLib,
        private readonly seed: string,
    ) {}

    private serverPriv(): string {
        return this.ecc.seedPrivate(this.seed)
    }

    isValidPublic(publicKey: string): boolean {
        return this.ecc.isValidPublic(publicKey)
    }

    /** Issues a fresh server-signed code that expires at `now + TTL`. */
    issue(now: number): IssuedCode {
        const code = JSON.stringify({ code: randomString(16), expire: now + CODE_TTL_SECONDS })
        return { code, serverSign: this.ecc.sign(code, this.serverPriv()) }
    }

    verifyServerSign(code: string, serverSign: string): boolean {
        return this.ecc.verify(serverSign, code, this.ecc.privateToPublic(this.serverPriv()))
    }

    /** Recovers the public key that produced `sign` over `code`. Throws if invalid. */
    recover(sign: string, code: string): string {
        return this.ecc.recover(sign, code)
    }
}
