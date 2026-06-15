import { describe, it, expect } from 'vitest'
import { RedisPresence, type RedisLike } from '../src/updates/redis-presence.js'

// --- RedisPresence over a fake sorted-set store ----------------------------

class FakeRedis implements RedisLike {
    private z = new Map<string, Map<string, number>>()

    async zadd(key: string, score: number, member: string): Promise<number> {
        const m = this.z.get(key) ?? new Map<string, number>()
        m.set(member, score)
        this.z.set(key, m)
        return 1
    }
    async zrem(key: string, member: string): Promise<number> {
        this.z.get(key)?.delete(member)
        return 1
    }
    async zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]> {
        const m = this.z.get(key)
        if (!m) return []
        const lo = Number(min)
        const hi = max === '+inf' ? Infinity : Number(max)
        return [...m.entries()].filter(([, s]) => s >= lo && s <= hi).map(([member]) => member)
    }
    async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
        const m = this.z.get(key)
        if (!m) return 0
        const lo = Number(min)
        const hi = Number(max)
        for (const [member, s] of [...m]) if (s >= lo && s <= hi) m.delete(member)
        return 1
    }
    async pexpire(): Promise<number> {
        return 1
    }
}

describe('RedisPresence', () => {
    it('adds, looks up, and expires entries by TTL', async () => {
        let clock = 1000
        const presence = new RedisPresence(new FakeRedis(), { ttlMs: 100, now: () => clock })

        await presence.add('u-7', 'nodeA')
        clock = 1050
        expect(await presence.lookup('u-7')).toEqual(['nodeA'])

        clock = 1200 // past the 100ms TTL without a refresh
        expect(await presence.lookup('u-7')).toEqual([])
    })

    it('tracks multiple nodes and removes one', async () => {
        let clock = 1000
        const presence = new RedisPresence(new FakeRedis(), { ttlMs: 1000, now: () => clock })
        await presence.add('u-42', 'nodeA')
        await presence.add('u-42', 'nodeB')
        clock = 1100
        expect((await presence.lookup('u-42')).sort()).toEqual(['nodeA', 'nodeB'])
        await presence.remove('u-42', 'nodeA')
        expect(await presence.lookup('u-42')).toEqual(['nodeB'])
    })

    it('refresh extends the lifetime', async () => {
        let clock = 1000
        const presence = new RedisPresence(new FakeRedis(), { ttlMs: 100, now: () => clock })
        await presence.add('u-1', 'nodeA')
        clock = 1080
        await presence.add('u-1', 'nodeA') // heartbeat -> score now 1180
        clock = 1150
        expect(await presence.lookup('u-1')).toEqual(['nodeA'])
    })
})
