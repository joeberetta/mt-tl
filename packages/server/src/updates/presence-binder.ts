import type { Connection } from '../transport/connection.js'
import type { ConnectionRegistry } from '../transport/connection-registry.js'
import type { Presence } from './presence.js'

/**
 * Couples a connection's authorized subject to the local registry and the global
 * presence map. The pipeline binds on authenticated messages; the dispatcher
 * binds/unbinds on bindUser/unbindUser effects; the carriers unbind on close.
 */
export interface PresenceBinder {
    bind(conn: Connection, subject: string): void
    /** Register a connection by its auth key (enables push to anonymous connections). */
    bindAuthKey(conn: Connection, authKeyId: string): void
    unbind(conn: Connection): void
}

export class NoopPresenceBinder implements PresenceBinder {
    bind(): void {}
    bindAuthKey(): void {}
    unbind(): void {}
}

export class NodePresenceBinder implements PresenceBinder {
    constructor(
        private readonly nodeId: string,
        private readonly registry: ConnectionRegistry,
        private readonly presence: Presence,
    ) {}

    bind(conn: Connection, subject: string): void {
        if (this.registry.subjectOf(conn) === subject) return // already bound — cheap no-op
        this.registry.register(subject, conn)
        void this.presence.add(subject, this.nodeId).catch(() => {})
    }

    bindAuthKey(conn: Connection, authKeyId: string): void {
        this.registry.registerAuthKey(authKeyId, conn) // no-op if already registered
        void this.presence.addAuthKey(authKeyId, this.nodeId).catch(() => {})
    }

    unbind(conn: Connection): void {
        const { subject, authKeyId } = this.registry.unregister(conn)
        // Only drop this node's presence once no local connection remains for the key.
        if (subject !== undefined && !this.registry.hasSubject(subject)) {
            void this.presence.remove(subject, this.nodeId).catch(() => {})
        }
        if (authKeyId !== undefined && !this.registry.hasAuthKey(authKeyId)) {
            void this.presence.removeAuthKey(authKeyId, this.nodeId).catch(() => {})
        }
    }
}
