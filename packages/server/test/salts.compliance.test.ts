import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildGateway, type Gateway } from '../src/gateway.js'
import { loadSchema } from '../src/tl/registry.js'
import { TlCodec } from '../src/tl/codec.js'
import type { TlObject } from '@mt-tl/tl'
import { TestClient, wsTransport } from '@mt-tl/testing'
import { SaltService } from '../src/session/salts.js'
import { createMemoryStorage } from '../src/storage/memory.js'

const { registry } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)

// --- unit: the salt scheduler (deterministic clock) ------------------------

describe('SaltService schedule', () => {
    it('mints distinct overlapping ~30min windows and rotates as time advances', async () => {
        let clock = 1_700_000_000
        const repo = createMemoryStorage().salts
        const svc = new SaltService(repo, { nowSec: () => clock, windowSec: 1800, stepSec: 900, prefetch: 1 })
        const key = 0xabcdn
        await svc.seed(key, 0x1111n)

        const fs = await svc.future(key, 3)
        expect(fs).toHaveLength(3)
        expect(fs[0]!.salt).toBe(0x1111n) // window 0 keeps the seeded (handshake) salt
        expect(new Set(fs.map(s => s.salt)).size).toBe(3) // distinct
        for (const s of fs) expect(s.validUntil - s.validSince).toBe(1800) // non-degenerate, 30 min
        expect(fs[1]!.validSince - fs[0]!.validSince).toBe(900) // step
        expect(fs[1]!.validSince).toBeLessThan(fs[0]!.validUntil) // overlap

        // The current salt validates; a bogus one does not.
        expect((await svc.resolve(key, 0x1111n)).valid).toBe(true)
        expect((await svc.resolve(key, 0x9999n)).valid).toBe(false)

        // Advance past window 0: the seeded salt expires and the current salt rotates.
        clock += 2000
        const r = await svc.resolve(key, 0x1111n)
        expect(r.valid).toBe(false)
        expect(r.current).not.toBe(0x1111n)
    })

    it('seed is idempotent and wire-compatible (keeps the first salt)', async () => {
        const repo = createMemoryStorage().salts
        const svc = new SaltService(repo, { nowSec: () => 1000 })
        await svc.seed(1n, 0xaaaan)
        await svc.seed(1n, 0xbbbbn) // ignored — schedule already exists
        expect((await svc.future(1n, 1))[0]!.salt).toBe(0xaaaan)
    })
})

// --- e2e: get_future_salts + bad_server_salt over a real gateway -----------

let gateway: Gateway

beforeAll(async () => {
    gateway = await buildGateway(
        {
            nodeId: 'salt-test-node',
            wsPort: 0,
            defaultLayer: 204,
            schemaDir,
            schemaLayersDir: layersDir,
            storage: { backend: 'memory' },
            updates: { enabled: false, presenceTtlMs: 60_000 },
        },
        {},
    )
    await gateway.listen()
})

afterAll(async () => {
    await gateway.close()
})

function newClient(): TestClient {
    return new TestClient(wsTransport(`ws://127.0.0.1:${gateway.wsServer!.port}`), gateway.publicKey, codec)
}

interface FutureSalt {
    valid_since: number
    valid_until: number
    salt: bigint
}

describe('server-salt compliance (e2e)', () => {
    it('get_future_salts(3) returns 3 distinct future salts with valid non-degenerate windows', async () => {
        const client = newClient()
        await client.connect()
        await client.handshake()

        // Open the session first (new_session_created + pong).
        await client.invoke({ _: 'ping', ping_id: 1n }, 2)

        const [reply] = await client.invoke({ _: 'get_future_salts', num: 3 }, 1)
        expect(reply!._).toBe('future_salts')

        const now = reply!.now as number
        const salts = reply!.salts as unknown as FutureSalt[]
        expect(salts).toHaveLength(3)

        // Distinct salts; the first is the handshake-derived salt (wire-compat).
        expect(new Set(salts.map(s => s.salt.toString())).size).toBe(3)
        expect(salts[0]!.salt).toBe(client.salt)

        for (const s of salts) {
            expect(s.valid_until).toBeGreaterThan(s.valid_since) // non-degenerate window
            expect(s.valid_until).toBeGreaterThan(now) // genuinely usable now or later
        }
        // Current window covers now; successors are future and overlapping.
        expect(salts[0]!.valid_since).toBeLessThanOrEqual(now)
        expect(salts[1]!.valid_since).toBeGreaterThan(salts[0]!.valid_since)
        expect(salts[1]!.valid_since).toBeLessThan(salts[0]!.valid_until)

        client.close()
    })

    it('replies bad_server_salt for a wrong salt, then accepts the corrected one', async () => {
        const client = newClient()
        await client.connect()
        await client.handshake()

        const correctSalt = client.salt
        const wrongSalt = correctSalt ^ 0xdeadbeefn // guaranteed different

        // A wrong salt earns a single bad_server_salt (no session is opened).
        const [bad] = await client.invoke({ _: 'ping', ping_id: 7n }, 1, { salt: wrongSalt })
        expect(bad!._).toBe('bad_server_salt')
        expect(bad!.error_code).toBe(48)
        expect(bad!.new_server_salt).toBe(correctSalt)
        expect(typeof bad!.bad_msg_id).toBe('bigint')

        // Adopt the advertised salt and re-send: now it goes through.
        client.salt = bad!.new_server_salt as bigint
        const replies = await client.invoke({ _: 'ping', ping_id: 8n }, 2)
        expect(replies.map(r => r._)).toContain('new_session_created')
        const pong = replies.find(r => r._ === 'pong') as TlObject
        expect(pong.ping_id).toBe(8n)

        client.close()
    })
})
