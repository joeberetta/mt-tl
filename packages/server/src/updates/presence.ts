/**
 * Global online-presence: which gateway node(s) currently hold a connection for
 * a subject. Written by gateways, read by the Update Router to route updates only
 * to nodes that actually hold the subject (no broadcast fan-out).
 *
 * Eventually-consistent is fine — a stale entry just routes to a node that drops
 * the update, and the client recovers via pts/getDifference.
 */
export interface Presence {
    add(subject: string, nodeId: string): Promise<void>
    remove(subject: string, nodeId: string): Promise<void>
    lookup(subject: string): Promise<string[]>
    /** Presence for a specific auth key (anonymous-capable delivery target). */
    addAuthKey(authKeyId: string, nodeId: string): Promise<void>
    removeAuthKey(authKeyId: string, nodeId: string): Promise<void>
    lookupAuthKey(authKeyId: string): Promise<string[]>
}

/** In-memory presence (single-process / tests). Use a Redis impl across nodes. */
export class InMemoryPresence implements Presence {
    // Keyed by a prefixed target string: `u:<subject>` or `a:<authKeyId>`.
    private map = new Map<string, Set<string>>()

    private addKey(key: string, nodeId: string): void {
        let set = this.map.get(key)
        if (!set) {
            set = new Set()
            this.map.set(key, set)
        }
        set.add(nodeId)
    }
    private removeKey(key: string, nodeId: string): void {
        const set = this.map.get(key)
        if (!set) return
        set.delete(nodeId)
        if (set.size === 0) this.map.delete(key)
    }
    private lookupKey(key: string): string[] {
        const set = this.map.get(key)
        return set ? [...set] : []
    }

    async add(subject: string, nodeId: string): Promise<void> {
        this.addKey(`u:${subject}`, nodeId)
    }
    async remove(subject: string, nodeId: string): Promise<void> {
        this.removeKey(`u:${subject}`, nodeId)
    }
    async lookup(subject: string): Promise<string[]> {
        return this.lookupKey(`u:${subject}`)
    }
    async addAuthKey(authKeyId: string, nodeId: string): Promise<void> {
        this.addKey(`a:${authKeyId}`, nodeId)
    }
    async removeAuthKey(authKeyId: string, nodeId: string): Promise<void> {
        this.removeKey(`a:${authKeyId}`, nodeId)
    }
    async lookupAuthKey(authKeyId: string): Promise<string[]> {
        return this.lookupKey(`a:${authKeyId}`)
    }
}
