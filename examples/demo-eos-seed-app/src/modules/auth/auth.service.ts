import type {
    CryptoSendCodeParams,
    CryptoSignInParams,
    CryptoSignUpParams,
    User,
} from '../../generated/schema.js'
import { BadRequestError } from '@mt-tl/server'
import { toTlUser } from '../users/user.mapper.js'
import type { UserService } from '../users/user.service.js'
import { CodeSigner, generateEosName } from './code-signer.js'

interface ParsedCode {
    code: string
    expire: number
}

/** A signed-code request carrying the four crypto-auth fields. */
type SignedRequest = Pick<CryptoSignInParams, 'public_key' | 'code' | 'server_sign' | 'sign'>

/**
 * Registration/authorization business logic, ported from `core/tl/crypto/*`.
 * Pure domain logic — no TL shaping, no `ctx`. The signature scheme (eosjs-ecc,
 * via {@link CodeSigner}) is faithful so the real mobile client interops; user
 * creation is minimal (no EOS chain account, restrictions, or sync).
 */
export class AuthService {
    constructor(
        private readonly users: UserService,
        private readonly signer: CodeSigner,
        private readonly now: () => number,
    ) {}

    /** Issues a server-signed code; reports whether the key is already registered. */
    async sendCode(
        params: CryptoSendCodeParams,
    ): Promise<{ code: string; serverSign: string; keyRegistered: boolean }> {
        if (!params.public_key || !this.signer.isValidPublic(params.public_key)) {
            throw new BadRequestError('PUBLIC_KEY_INVALID')
        }
        const { code, serverSign } = this.signer.issue(this.now())
        const keyRegistered = (await this.users.byPublicKey(params.public_key)) !== null
        return { code, serverSign, keyRegistered }
    }

    /**
     * Authorizes an existing key pair. Returns the user's `subject` (internal uuid)
     * for the gateway to bind via `ctx.login(subject)`, plus the TL `user` whose
     * `id` is the PUBLIC int — the two ids the row links live side by side here.
     */
    async signIn(params: CryptoSignInParams): Promise<{ subject: string; user: User }> {
        const publicKey = this.verifyAndRecover(params)
        const user = await this.users.byPublicKey(publicKey)
        if (!user) throw new BadRequestError('PUBLIC_KEY_UNOCCUPIED')
        return { subject: user.subject, user: toTlUser(user, true) }
    }

    /** Registers a new key pair. */
    async signUp(params: CryptoSignUpParams): Promise<{ subject: string; user: User }> {
        const firstName = params.first_name.trim()
        if (!firstName) throw new BadRequestError('FIRSTNAME_EMPTY')
        const lastName = params.last_name.trim()
        const username = params.username.trim().replace(/^@+/, '')
        const email = (params.email ?? '').trim().toLowerCase()

        const publicKey = this.verifyAndRecover(params)

        if (await this.users.byPublicKey(publicKey)) throw new BadRequestError('PUBLIC_KEY_INVALID')
        if (email && (await this.users.byEmail(email))) throw new BadRequestError('EMAIL_OCCUPIED')
        if (username && (await this.users.byUsername(username)))
            throw new BadRequestError('USERNAME_OCCUPIED')

        const user = await this.users.register({
            publicKey,
            eosName: generateEosName(),
            firstName,
            lastName,
            username,
            email,
            phone: params.phone_number ?? '',
            country: params.country,
        })
        return { subject: user.subject, user: toTlUser(user, true) }
    }

    /** Verifies server_sign + code validity/expiry, recovers the signer, asserts it matches. */
    private verifyAndRecover(p: SignedRequest): string {
        if (!p.server_sign) throw new BadRequestError('SERVER_SIGN_INVALID')
        if (!p.sign) throw new BadRequestError('SIGN_INVALID')
        if (!p.code) throw new BadRequestError('CODE_INVALID')
        if (!this.signer.verifyServerSign(p.code, p.server_sign)) throw new BadRequestError('CODE_INVALID')

        const parsed = this.parseCode(p.code)
        if (parsed.expire < this.now()) throw new BadRequestError('CODE_EXPIRED')

        let recovered: string
        try {
            recovered = this.signer.recover(p.sign, p.code)
        } catch {
            throw new BadRequestError('SIGN_INVALID')
        }
        if (recovered !== p.public_key) throw new BadRequestError('PUBLIC_KEY_INVALID')
        return recovered
    }

    private parseCode(code: string): ParsedCode {
        let parsed: unknown
        try {
            parsed = JSON.parse(code)
        } catch {
            throw new BadRequestError('CODE_INVALID')
        }
        const c = parsed as ParsedCode
        if (!c || typeof c.expire !== 'number' || typeof c.code !== 'string') {
            throw new BadRequestError('CODE_INVALID')
        }
        return c
    }
}
