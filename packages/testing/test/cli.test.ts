import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { stringify } from 'yaml'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { RpcMethodSpec } from '@mt-tl/server'
import { createTestServer, type InvokeTrace, type ConnectOpts } from '../src/index.js'
import { runFromFiles, runScenario, type RecipeMap } from '../src/cli/index.js'

type AnyMethods = Record<string, RpcMethodSpec>

// End-to-end through the FULL CLI pipeline (YAML → connect → real WS handshake →
// multi-user steps), driven against an in-process server. Proves the runner's
// auth, invoke/expect, capture+interpolation, expectUpdate routing, expectError,
// and failure reporting.

const BALANCE_UPDATE = {
    _: 'updateShort',
    update: { _: 'abstract.updateBalance', wallet_id: 'w1' },
    date: 1_700_000_000,
}

let server: Awaited<ReturnType<typeof createTestServer>>
let dir: string
let pemPath: string

beforeAll(async () => {
    server = await createTestServer<AnyMethods>({
        schemaDir,
        schemaLayersDir: layersDir,
        register: app => {
            // Login as the api_id-carried user (subject = stringified api_id); echo api_hash back.
            app.method('crypto.sendCode', { auth: false }, async (p, ctx) => {
                const params = p as { api_id: number; api_hash: string }
                ctx.login(String(params.api_id))
                return { _: 'dataJSON', data: String(params.api_hash) }
            })
            // Push-to-self: emit an update to the caller.
            app.method('help.getServerConfig', { auth: false }, async (_p, ctx) => {
                await ctx.push(ctx.subject!, BALANCE_UPDATE)
                return { _: 'dataJSON', data: '{}' }
            })
            // Auth-required: exercises the rpc_error (401) path pre-login.
            app.method('updates.getState', async () => ({
                _: 'updates.state',
                pts: 0,
                qts: 0,
                date: 0,
                seq: 0,
                unread_count: 0,
            }))
        },
    })
    dir = mkdtempSync(join(tmpdir(), 'mtproto-cli-'))
    pemPath = join(dir, 'server.pem')
    writeFileSync(pemPath, server.publicKey.export({ type: 'spki', format: 'pem' }) as string)
})

afterAll(async () => {
    await server.close()
    rmSync(dir, { recursive: true, force: true })
})

function writeScenario(name: string, scenario: unknown): string {
    const path = join(dir, name)
    writeFileSync(path, stringify(scenario))
    return path
}

describe('mtproto-test CLI runner', () => {
    it('runs a multi-user scenario: auth, invoke/expect, capture+interpolation, per-user push', async () => {
        const path = writeScenario('happy.yaml', {
            target: { url: server.url, schema: schemaDir, publicKey: pemPath },
            vars: { tag: 'hello' },
            users: {
                alice: {
                    auth: {
                        steps: [
                            {
                                invoke: 'crypto.sendCode',
                                params: { public_key: '', api_id: 1001, api_hash: '${tag}' },
                                capture: { 'alice.echo': 'data' },
                                expect: { _: 'dataJSON' },
                            },
                        ],
                    },
                },
                bob: {
                    auth: {
                        steps: [
                            {
                                invoke: 'crypto.sendCode',
                                params: { public_key: '', api_id: 1002, api_hash: 'bob' },
                            },
                        ],
                    },
                },
            },
            steps: [
                // ${alice.echo} was captured as 'hello' (= ${tag}); echo it back and assert.
                {
                    as: 'alice',
                    invoke: 'crypto.sendCode',
                    params: { public_key: '', api_id: 1001, api_hash: '${alice.echo}' },
                    expect: { data: 'hello' },
                },
                { as: 'alice', invoke: 'help.getServerConfig', expect: { _: 'dataJSON' } },
                { as: 'alice', expectUpdate: 'updateShort', capture: { 'alice.wallet': 'update.wallet_id' } },
                { as: 'bob', invoke: 'help.getServerConfig' },
                { as: 'bob', expectUpdate: { _: 'updateShort' } },
            ],
        })

        const report = await runFromFiles({ scenario: path, log: () => {} })

        expect(report.ok).toBe(true)
        expect(report.steps.every(s => s.ok)).toBe(true)
        expect(report.steps).toHaveLength(7) // 2 auth + 5 steps
        expect(report.users.sort()).toEqual(['alice', 'bob'])
    })

    it('reports a failing step and validates expectError', async () => {
        const path = writeScenario('failing.yaml', {
            target: { url: server.url, schema: schemaDir, publicKey: pemPath },
            users: {
                alice: {
                    auth: {
                        steps: [
                            {
                                invoke: 'crypto.sendCode',
                                params: { public_key: '', api_id: 2001, api_hash: 'x' },
                            },
                        ],
                    },
                },
                stranger: {},
            },
            steps: [
                // No push is triggered → this times out → FAILS.
                { as: 'alice', label: 'no-push', expectUpdate: { _: 'updateShort' }, timeoutMs: 200 },
                // Pre-login auth gate → 401 rpc_error → expectError PASSES.
                { as: 'stranger', invoke: 'updates.getState', expectError: { code: 401 } },
            ],
        })

        const report = await runFromFiles({ scenario: path, log: () => {} })

        expect(report.ok).toBe(false)
        const timedOut = report.steps.find(s => s.label === 'no-push')
        expect(timedOut?.ok).toBe(false)
        expect(timedOut?.error).toMatch(/timed out/)
        const stranger = report.steps.find(s => s.user === 'stranger')
        expect(stranger?.ok).toBe(true)
    })

    it('passes custom ${...} generators to interpolation', async () => {
        const report = await runScenario(
            {
                target: { url: server.url },
                steps: [
                    // crypto.sendCode echoes api_hash into `data`; ${token} comes from a generator.
                    {
                        as: 'alice',
                        invoke: 'crypto.sendCode',
                        params: { public_key: '', api_id: 9001, api_hash: '${token}' },
                        expect: { data: 'GENERATED' },
                    },
                ],
            },
            { connect: () => server.connect(), generators: { token: () => 'GENERATED' } },
        )
        expect(report.ok).toBe(true)
    })

    it('emits an InvokeTrace per call when onInvoke is set (--verbose)', async () => {
        const traces: InvokeTrace[] = []
        const s = await server.connect({ onInvoke: t => traces.push(t) })
        const res = await s.invoke('crypto.sendCode', {
            public_key: '',
            api_id: 9002,
            api_hash: 'echo-me',
        })
        s.close()
        expect(res.data).toBe('echo-me')
        expect(traces).toHaveLength(1)
        expect(traces[0]!.method).toBe('crypto.sendCode')
        expect(traces[0]!.params.api_hash).toBe('echo-me')
        expect((traces[0]!.result as { data: string }).data).toBe('echo-me')
        expect(typeof traces[0]!.durationMs).toBe('number')
    })

    it('reports received pushes via onUpdate (--verbose)', async () => {
        const pushes: { _: string }[] = []
        const s = await server.connect({ onUpdate: u => pushes.push(u as { _: string }) })
        await s.invoke('crypto.sendCode', { public_key: '', api_id: 9100, api_hash: 'x' }) // binds subject
        await s.invoke('help.getServerConfig') // pushes BALANCE_UPDATE to the caller
        await s.expectUpdate('updateShort')
        s.close()
        expect(pushes.some(u => u._ === 'updateShort')).toBe(true)
    })

    it('runs a `recipe` step (a reusable multi-call macro)', async () => {
        let ran = 0
        const recipes: RecipeMap = {
            warmup: async ({ session }) => {
                await session.invoke('crypto.sendCode', { public_key: '', api_id: 1, api_hash: 'a' })
                await session.invoke('help.getServerConfig')
                ran++
            },
        }
        const report = await runScenario(
            {
                target: { url: server.url },
                steps: [{ as: 'alice', recipe: 'warmup' }],
            },
            { connect: () => server.connect(), recipes },
        )
        expect(report.ok).toBe(true)
        expect(ran).toBe(1)
        expect(report.steps.find(s => s.label === 'recipe warmup')?.ok).toBe(true)
    })

    it('namespaces recipe captures by user → ${otherUser.key} resolves across users', async () => {
        // The recipe sets a FLAT key (no per-user prefix); the runner namespaces it so
        // one user's step can reference another user's login result (e.g. a peer id).
        const recipes: RecipeMap = {
            signup: async ({ scope, user }) => {
                scope.set('userId', user === 'bob' ? '22' : '11')
            },
        }
        const report = await runScenario(
            {
                target: { url: server.url },
                users: {
                    alice: { auth: { recipe: 'signup' } },
                    bob: { auth: { recipe: 'signup' } },
                },
                steps: [
                    // alice references BOB's captured userId — crypto.sendCode echoes api_hash into `data`.
                    {
                        as: 'alice',
                        invoke: 'crypto.sendCode',
                        params: { public_key: '', api_id: 1, api_hash: '${bob.userId}' },
                        expect: { data: '22' },
                    },
                ],
            },
            { connect: () => server.connect(), recipes },
        )
        expect(report.ok).toBe(true)
        expect(report.steps.every(s => s.ok)).toBe(true)
    })

    it('accepts studio-style direct ctx.scope assignment (`ctx.scope.userId = …`)', async () => {
        // A recipe written for @mt-tl/studio captures via a plain `ctx.scope.x = …`.
        // testing's ctx.scope is a Scope instance, but the runner's userScope trap
        // routes the assignment into the interpolation scope (flat + per-user).
        const recipes: RecipeMap = {
            signup: async ({ scope, user }) => {
                ;(scope as unknown as Record<string, unknown>).userId = user === 'bob' ? '99' : '11'
            },
        }
        const report = await runScenario(
            {
                target: { url: server.url },
                users: { alice: { auth: { recipe: 'signup' } }, bob: { auth: { recipe: 'signup' } } },
                steps: [
                    { as: 'alice', invoke: 'crypto.sendCode', params: { public_key: '', api_id: 1, api_hash: '${bob.userId}' }, expect: { data: '99' } },
                ],
            },
            { connect: () => server.connect(), recipes },
        )
        expect(report.ok).toBe(true)
    })

    it('logs auth_key_id + session_id once per user on connect', async () => {
        const lines: string[] = []
        await runScenario(
            {
                target: { url: server.url },
                users: { alice: {} }, // anonymous still handshakes → ids are set
                steps: [{ as: 'alice', invoke: 'crypto.sendCode', params: { public_key: '', api_id: 1, api_hash: 'x' }, expect: { _: 'dataJSON' } }],
            },
            { connect: () => server.connect(), log: l => lines.push(l) },
        )
        const connectLine = lines.find(l => /connected alice/.test(l) && /auth_key_id/.test(l) && /session_id/.test(l))
        expect(connectLine).toBeDefined()
        expect(connectLine).toMatch(/auth_key_id [0-9a-f]{16} \(\d+\) · session_id [0-9a-f]{16} \(\d+\)/)
    })

    it('runs a non-blocking expectUpdate: armed before its trigger, settled at the end', async () => {
        const report = await runScenario(
            {
                target: { url: server.url },
                users: {
                    // login binds the subject so help.getServerConfig can push to alice.
                    alice: { auth: { steps: [{ invoke: 'crypto.sendCode', params: { public_key: '', api_id: 1, api_hash: 'a' } }] } },
                },
                steps: [
                    // Armed FIRST but non-blocking — would DEADLOCK if it blocked, since the
                    // push is only emitted by the NEXT step. Order-independent + checked at end.
                    { as: 'alice', label: 'await-push', expectUpdate: { _: 'updateShort' }, nonBlocking: true, timeoutMs: 2000 },
                    { as: 'alice', invoke: 'help.getServerConfig' },
                ],
            },
            { connect: () => server.connect() },
        )
        expect(report.ok).toBe(true)
        const awaited = report.steps.find(s => s.label.startsWith('await-push'))
        expect(awaited?.ok).toBe(true)
        expect(awaited?.label).toContain('[non-blocking]')
    })

    it('two non-blocking expectUpdates each consume one of two pushes (count assertion)', async () => {
        const report = await runScenario(
            {
                target: { url: server.url },
                users: {
                    alice: { auth: { steps: [{ invoke: 'crypto.sendCode', params: { public_key: '', api_id: 1, api_hash: 'a' } }] } },
                },
                steps: [
                    // Two armed expectations (same matcher); each grabs a distinct update.
                    { as: 'alice', label: 'msg1', expectUpdate: { _: 'updateShort' }, nonBlocking: true, timeoutMs: 2000 },
                    { as: 'alice', label: 'msg2', expectUpdate: { _: 'updateShort' }, nonBlocking: true, timeoutMs: 2000 },
                    { as: 'alice', invoke: 'help.getServerConfig' }, // push #1
                    { as: 'alice', invoke: 'help.getServerConfig' }, // push #2
                ],
            },
            { connect: () => server.connect() },
        )
        expect(report.ok).toBe(true)
        expect(report.steps.find(s => s.label.startsWith('msg1'))?.ok).toBe(true)
        expect(report.steps.find(s => s.label.startsWith('msg2'))?.ok).toBe(true)
    })

    it('fails a non-blocking expectUpdate that never arrives, without erroring on other updates', async () => {
        const report = await runScenario(
            {
                target: { url: server.url },
                users: {
                    alice: { auth: { steps: [{ invoke: 'crypto.sendCode', params: { public_key: '', api_id: 1, api_hash: 'a' } }] } },
                },
                steps: [
                    // This update type never comes; the unrelated updateShort push must NOT error it.
                    { as: 'alice', label: 'never', expectUpdate: { _: 'updateNeverHappens' }, nonBlocking: true, timeoutMs: 300 },
                    { as: 'alice', invoke: 'help.getServerConfig' }, // pushes an (ignored) updateShort
                ],
            },
            { connect: () => server.connect() },
        )
        expect(report.ok).toBe(false)
        const never = report.steps.find(s => s.label.startsWith('never'))
        expect(never?.ok).toBe(false)
        expect(never?.error).toMatch(/timed out/)
        // the invoke step itself still succeeded — the stray update didn't break anything
        expect(report.steps.find(s => s.label === 'invoke help.getServerConfig')?.ok).toBe(true)
    })

    it('connects users on per-user layers and supports anonymous (no-auth) sessions', async () => {
        const seen = new Map<string, ConnectOpts | undefined>()
        const report = await runScenario(
            {
                target: { url: server.url, layer: 204 },
                users: {
                    // Explicit per-user layer (overrides target.layer=204).
                    mira: {
                        layer: 185,
                        auth: {
                            steps: [{ invoke: 'crypto.sendCode', params: { public_key: '', api_id: 1, api_hash: 'm' } }],
                        },
                    },
                    // Anonymous: no `auth` → still connects + handshakes, just unauthenticated.
                    nyx: {},
                },
                steps: [
                    {
                        as: 'nyx',
                        invoke: 'crypto.sendCode', // an auth:false method an anonymous session can still call
                        params: { public_key: '', api_id: 2, api_hash: 'n' },
                        expect: { _: 'dataJSON' },
                    },
                ],
            },
            {
                connect: (user, opts) => {
                    seen.set(user, opts)
                    return server.connect(opts)
                },
            },
        )
        expect(report.ok).toBe(true)
        expect(seen.get('mira')?.layer).toBe(185) // per-user override applied
        expect(seen.has('nyx')).toBe(true) // anonymous user still connected
        expect(seen.get('nyx')?.layer).toBeUndefined() // …at the target/server default
    })
})
