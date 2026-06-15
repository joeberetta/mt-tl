import { createRequire } from 'node:module'

/**
 * The slice of `eosjs-ecc` (EOS/secp256k1) the auth flow uses. The mobile
 * client signs the server-issued code with its private key; the server verifies
 * its own `server_sign` and `recover`s the client's public key from `sign`.
 * Identity = an EOS key pair, not a phone number.
 */
export interface EccLib {
    isValidPublic(pub: string): boolean
    seedPrivate(seed: string): string
    privateToPublic(priv: string): string
    sign(data: string, priv: string): string
    verify(sig: string, data: string, pub: string): boolean
    recover(sig: string, data: string): string
}

let cached: EccLib | undefined

/** Lazily loads `eosjs-ecc` (CommonJS) so dependency-free paths stay light. */
export function loadEcc(): EccLib {
    if (!cached) {
        const require = createRequire(import.meta.url)
        cached = require('eosjs-ecc') as EccLib
    }
    return cached
}
