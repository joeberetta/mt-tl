import type { AccountCheckFieldsParams } from '../../generated/schema.js'
import { BadRequestError } from '@mt-tl/server'
import type { UserService } from '../users/user.service.js'

/**
 * Registration field checks, ported from `core/tl/account/checkFields.js`.
 * Depends on the `users` module's {@link UserService} (the cross-module "port"
 * pattern: account never imports the users module).
 *
 * Lenient by design: this demo only enforces **occupancy** (email/username not
 * already taken) + basic non-empty/length sanity. Real format rules
 * (`isInvalidEmail`/`isInvalidUserName`) live in `core`; mirroring them too
 * strictly here rejected valid clients, so we keep the demo permissive.
 */
export class AccountService {
    constructor(private readonly users: UserService) {}

    /** Throws {@link BadRequestError} on the first problem; resolves if all OK. */
    async checkFields(p: AccountCheckFieldsParams): Promise<void> {
        if (p.email != null && p.email.trim()) {
            const email = p.email.trim().toLowerCase()
            if (await this.users.byEmail(email)) throw new BadRequestError('EMAIL_OCCUPIED')
        }
        if (p.first_name != null) {
            const firstName = p.first_name.trim()
            if (!firstName) throw new BadRequestError('FIRSTNAME_EMPTY')
            if (firstName.length > 64) throw new BadRequestError('FIRSTNAME_TOO_LONG')
        }
        if (p.last_name != null && p.last_name.trim().length > 64) {
            throw new BadRequestError('LASTNAME_TOO_LONG')
        }
        if (p.username != null && p.username.trim()) {
            const username = p.username.trim().replace(/^@+/, '')
            if (username.length > 32) throw new BadRequestError('USERNAME_TOO_LONG')
            if (await this.users.byUsername(username)) throw new BadRequestError('USERNAME_OCCUPIED')
        }
    }
}
