import Redis from 'ioredis'
import type { Presence } from './presence.js'

/** Minimal subset of ioredis used by {@link RedisPresence} (for testability). */
export interface RedisLike {
    zadd(key: string, score: number, member: string): Promise<unknown>
    zrem(key: string, member: string): Promise<unknown>
    zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>
    zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>
    pexpire(key: string, ms: number): Promise<unknown>
}

export interface RedisPresenceOptions {
    ttlMs?: number
    now?: () => number
}

/**
 * Redis-backed presence using a per-subject sorted set `presence:{subject}` with
 * member = nodeId and score = expiry epoch (now + ttl). This gives per-member
 * TTL: a node's entry is considered live while its score is in the future and
 * is refreshed by a heartbeat; stale entries are pruned on lookup. Eventually
 * consistent by design (a crashed node's entry just expires).
 */
export class RedisPresence implements Presence {
    constructor(
        private readonly redis: RedisLike,
        private readonly opts: RedisPresenceOptions = {},
    ) {}

    private ttl(): number {
        return this.opts.ttlMs ?? 60_000
    }
    private now(): number {
        return (this.opts.now ?? Date.now)()
    }
    private key(subject: string): string {
        return `presence:${subject}`
    }
    private authKey(authKeyId: string): string {
        return `presence:a:${authKeyId}`
    }

    private async addKey(key: string, nodeId: string): Promise<void> {
        await this.redis.zadd(key, this.now() + this.ttl(), nodeId)
        await this.redis.pexpire(key, this.ttl() * 2)
    }
    private async lookupKey(key: string): Promise<string[]> {
        const now = this.now()
        await this.redis.zremrangebyscore(key, 0, now) // drop expired members
        return this.redis.zrangebyscore(key, now, '+inf') // live members
    }

    async add(subject: string, nodeId: string): Promise<void> {
        await this.addKey(this.key(subject), nodeId)
    }
    async remove(subject: string, nodeId: string): Promise<void> {
        await this.redis.zrem(this.key(subject), nodeId)
    }
    async lookup(subject: string): Promise<string[]> {
        return this.lookupKey(this.key(subject))
    }
    async addAuthKey(authKeyId: string, nodeId: string): Promise<void> {
        await this.addKey(this.authKey(authKeyId), nodeId)
    }
    async removeAuthKey(authKeyId: string, nodeId: string): Promise<void> {
        await this.redis.zrem(this.authKey(authKeyId), nodeId)
    }
    async lookupAuthKey(authKeyId: string): Promise<string[]> {
        return this.lookupKey(this.authKey(authKeyId))
    }
}

export interface RedisPresenceHandle {
    presence: RedisPresence
    close: () => Promise<void>
}

export function createRedisPresence(url: string, ttlMs: number): RedisPresenceHandle {
    const client = new Redis(url, { lazyConnect: false })
    return {
        presence: new RedisPresence(client, { ttlMs }),
        close: async () => {
            await client.quit()
        },
    }
}
