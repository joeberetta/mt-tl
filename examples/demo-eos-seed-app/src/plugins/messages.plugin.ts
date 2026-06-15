import type { MessagesDialogs } from '../generated/schema.js'
import { definePlugin } from '../framework.js'
import { loadCurrentUser } from '../hooks.js'
import type { UserService } from '../modules/users/index.js'

const emptyDialogs: MessagesDialogs = {
    _: 'messages.dialogs',
    dialogs: [],
    messages: [],
    chats: [],
    users: [],
}

/**
 * Messages routes. Stub for the alpha: empty dialog lists let the main screen
 * render. Real version ports `core/tl/messages/*` over a MessageService.
 *
 * Declares the `users` service it needs — the composition root passes it via
 * `app.register(messagesPlugin, { users })`. `loadCurrentUser(users)` is built
 * here (at registration), so `users` is already in scope.
 */
export const messagesPlugin = definePlugin<{ users: UserService }>((app, { users }) => {
    app.method('messages.getDialogs', { preHandlers: [loadCurrentUser(users)] }, async () => emptyDialogs)
    app.method('messages.getServiceChats', async () => emptyDialogs)
})
