import type { NewUser, StoredUser, UserRepo } from './user.repo.js'

/**
 * User domain service. Other modules (auth) depend on this, not on the repo —
 * the users module *provides* it. Thin today; the place to add caching, events,
 * or invariants as the surface grows.
 */
export class UserService {
    constructor(private readonly repo: UserRepo) {}

    /** Resolve by the public TL id (int) — what arrives in `inputUser.user_id`. */
    byId(id: number): Promise<StoredUser | null> {
        return this.repo.getById(id)
    }
    /** Resolve by the internal subject (uuid) — what the gateway binds as `ctx.subject`. */
    bySubject(subject: string): Promise<StoredUser | null> {
        return this.repo.getBySubject(subject)
    }
    byPublicKey(publicKey: string): Promise<StoredUser | null> {
        return this.repo.findByPublicKey(publicKey)
    }
    byUsername(username: string): Promise<StoredUser | null> {
        return this.repo.findByUsername(username)
    }
    byEmail(email: string): Promise<StoredUser | null> {
        return this.repo.findByEmail(email)
    }
    register(input: NewUser): Promise<StoredUser> {
        return this.repo.create(input)
    }
}
