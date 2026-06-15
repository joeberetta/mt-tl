import type { User } from '../../generated/schema.js'
import type { StoredUser } from './user.repo.js'

/**
 * Renders a stored user as the canonical TL `user`. The gateway re-encodes it
 * at the client's negotiated layer. Optional `flags.N?` fields are omitted when
 * empty so the flags int stays minimal.
 */
export function toTlUser(u: StoredUser, self: boolean): User {
    return {
        _: 'user',
        id: u._id,
        ...(self ? { self: true } : {}),
        ...(u.firstName ? { first_name: u.firstName } : {}),
        ...(u.lastName ? { last_name: u.lastName } : {}),
        ...(u.username ? { username: u.username } : {}),
        ...(u.phone ? { phone: u.phone } : {}),
        email: u.email ?? '',
        eos_name: u.eosName ?? '',
        photo: { _: 'userProfilePhotoEmpty' },
        access_hash: 0n,
        kyc_verifed: 0,
    }
}
