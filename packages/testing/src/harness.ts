import type { TestServer } from './server.js'
import type { TestSession, ConnectOpts } from './session.js'

/** Manages several named, independently-authenticated sessions against one server. */
export interface TestHarness {
    /** Get-or-create the session for `name` (connects + handshakes on first use).
     *  `opts` (e.g. `{ layer }`) applies only when the session is first created. */
    user(name: string, opts?: ConnectOpts): Promise<TestSession>
    /** All sessions created so far, by name. */
    readonly sessions: Map<string, TestSession>
    /** Close every session (does not close the server). */
    closeAll(): void
}

/**
 * A thin multi-user layer over a {@link TestServer}: name your users, drive each
 * independently, and assert per-user delivery — e.g. user1 sends, user2 sees the
 * push. Each `user()` is a distinct connection with its own auth key, so logins
 * and updates are isolated exactly as in production.
 *
 * @example
 * ```ts
 * const h = createHarness(server)
 * const alice = await h.user('alice')
 * const bob = await h.user('bob')
 * await alice.invoke('messages.sendMessage', { ... })
 * await bob.expectUpdate('updateNewMessage')
 * h.closeAll()
 * ```
 */
export function createHarness<RM>(server: TestServer<RM>): TestHarness {
    const sessions = new Map<string, TestSession>()
    const connecting = new Map<string, Promise<TestSession>>()

    return {
        sessions,
        async user(name: string, opts?: ConnectOpts): Promise<TestSession> {
            const existing = sessions.get(name)
            if (existing) return existing
            let pending = connecting.get(name)
            if (!pending) {
                pending = server.connect(opts).then(session => {
                    sessions.set(name, session)
                    connecting.delete(name)
                    return session
                })
                connecting.set(name, pending)
            }
            return pending
        },
        closeAll(): void {
            for (const session of sessions.values()) session.close()
            sessions.clear()
            connecting.clear()
        },
    }
}
