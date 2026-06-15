import type { UserFull, UsersGetFullUserParams } from '../generated/schema.js'
import { NotFoundError } from '@mt-tl/server'
import { definePlugin } from '../framework.js'
import { UserService, toTlUser } from '../modules/users/index.js'

// `ContactLink` collapses to its primary constructor in the generated types;
// the "unknown" variant is wire-valid for the field but needs a cast.
const contactLinkUnknown = { _: 'contactLinkUnknown' } as unknown as UserFull['link']['my_link']

/** Users routes: the client fetches its own (or another user's) full profile. */
export const usersPlugin = definePlugin<{ users: UserService }>((app, { users }) => {
    app.method('users.getFullUser', async (params: UsersGetFullUserParams, ctx) => {
        // The two ids meet HERE and only here:
        //   • params.id.user_id — the PUBLIC int the client sent in `inputUser` (wire).
        //   • ctx.subject       — the INTERNAL uuid the gateway bound to this auth key.
        // Resolve whoever was asked for: a given public id → byId; otherwise "me" → bySubject.
        // (`auth: true` by default ⇒ ctx.subject is guaranteed present.)
        const id = params.id as { user_id?: number }
        const stored =
            typeof id?.user_id === 'number'
                ? await users.byId(id.user_id) // public int  → user
                : await users.bySubject(ctx.subject!) // internal uuid → me
        if (!stored) throw new NotFoundError('USER_NOT_FOUND')

        // "self" compares on the INTERNAL id; the TL `user.id` rendered below is the public int.
        const tlUser = toTlUser(stored, stored.subject === ctx.subject)
        return {
            _: 'userFull',
            user: tlUser,
            link: {
                _: 'contacts.link',
                my_link: contactLinkUnknown,
                foreign_link: contactLinkUnknown,
                user: tlUser,
            },
            notify_settings: { _: 'peerNotifySettings' },
            common_chats_count: 0,
        } satisfies UserFull
    })
})
