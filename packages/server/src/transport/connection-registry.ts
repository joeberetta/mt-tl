import type { Connection } from './connection.js'

/**
 * Per-node map of authorized subject -> live connections, used to deliver
 * server-pushed updates to the right sockets. A subject (internal user id) may
 * have several connections (multiple devices/sessions) on one node.
 */
export class ConnectionRegistry {
    private bySubject = new Map<string, Set<Connection>>()
    private connSubject = new Map<Connection, string>()
    private byAuthKey = new Map<string, Set<Connection>>()
    private connAuthKey = new Map<Connection, string>()

    register(subject: string, conn: Connection): void {
        const prev = this.connSubject.get(conn)
        if (prev !== undefined && prev !== subject) removeFrom(this.bySubject, prev, conn)
        this.connSubject.set(conn, subject)
        addTo(this.bySubject, subject, conn)
    }

    /** Index a connection by its auth key, for delivery before/without a subject. */
    registerAuthKey(authKeyId: string, conn: Connection): void {
        if (this.connAuthKey.get(conn) === authKeyId) return
        this.connAuthKey.set(conn, authKeyId)
        addTo(this.byAuthKey, authKeyId, conn)
    }

    /** Remove a connection from both indexes; returns the keys it was held under. */
    unregister(conn: Connection): { subject?: string; authKeyId?: string } {
        const subject = this.connSubject.get(conn)
        if (subject !== undefined) {
            this.connSubject.delete(conn)
            removeFrom(this.bySubject, subject, conn)
        }
        const authKeyId = this.connAuthKey.get(conn)
        if (authKeyId !== undefined) {
            this.connAuthKey.delete(conn)
            removeFrom(this.byAuthKey, authKeyId, conn)
        }
        return { subject, authKeyId }
    }

    subjectOf(conn: Connection): string | undefined {
        return this.connSubject.get(conn)
    }

    hasSubject(subject: string): boolean {
        return this.bySubject.has(subject)
    }
    hasAuthKey(authKeyId: string): boolean {
        return this.byAuthKey.has(authKeyId)
    }

    getBySubject(subject: string): Connection[] {
        const set = this.bySubject.get(subject)
        return set ? [...set] : []
    }
    getByAuthKey(authKeyId: string): Connection[] {
        const set = this.byAuthKey.get(authKeyId)
        return set ? [...set] : []
    }

    /** All subjects with at least one local connection (for presence heartbeat). */
    subjects(): string[] {
        return [...this.bySubject.keys()]
    }
    /** All auth keys with at least one local connection (for presence heartbeat). */
    authKeys(): string[] {
        return [...this.byAuthKey.keys()]
    }

    get size(): number {
        return this.connSubject.size
    }
}

function addTo<K>(map: Map<K, Set<Connection>>, key: K, conn: Connection): void {
    let set = map.get(key)
    if (!set) {
        set = new Set()
        map.set(key, set)
    }
    set.add(conn)
}

function removeFrom<K>(map: Map<K, Set<Connection>>, key: K, conn: Connection): void {
    const set = map.get(key)
    if (!set) return
    set.delete(conn)
    if (set.size === 0) map.delete(key)
}
