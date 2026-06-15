import type { UserService } from '../users/user.service.js'
import { AuthService } from './auth.service.js'
import { CodeSigner } from './code-signer.js'
import { loadEcc, type EccLib } from './ecc.js'

// Domain only — no routes. The auth ROUTER lives in plugins/auth.plugin.ts.

const unixNow = () => Math.floor(Date.now() / 1000)

export interface AuthServiceDeps {
    /** Provided by the users module. */
    users: UserService
    /** Server EOS seed (signs/verifies the auth code). Secret. */
    serverSeed: string
    /** Override the ECC lib (tests inject a fake to avoid eosjs-ecc). */
    ecc?: EccLib
    /** Unix-seconds clock; injectable for deterministic tests. */
    now?: () => number
}

/** Builds the AuthService (signer + service) for the composition root. */
export function buildAuthService(deps: AuthServiceDeps): AuthService {
    const signer = new CodeSigner(deps.ecc ?? loadEcc(), deps.serverSeed)
    return new AuthService(deps.users, signer, deps.now ?? unixNow)
}

export { AuthService } from './auth.service.js'
export { CodeSigner, generateEosName } from './code-signer.js'
export { loadEcc, type EccLib } from './ecc.js'
