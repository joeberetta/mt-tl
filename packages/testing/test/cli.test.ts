import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { stringify } from 'yaml'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { RpcMethodSpec } from '@mt-tl/server'
import { createTestServer, type InvokeTrace } from '../src/index.js'
import { runFromFiles, runScenario } from '../src/cli/index.js'

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
        const res = await s.invoke<{ _: string; data: string }>('crypto.sendCode', {
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
})
