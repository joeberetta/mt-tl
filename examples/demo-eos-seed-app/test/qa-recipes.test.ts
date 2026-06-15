import { schemaDir, layersDir } from '../src/schema.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestServer, type TestServer } from '@mt-tl/testing'
import { runScenario } from '@mt-tl/testing/cli'
import type { RpcMethods } from '../src/generated/schema.js'
import { demoApp } from '../src/app.js'
import { recipes } from '../testing/recipes.js'

// Drives the demo's EOS auth recipes (testing/recipes.ts) end-to-end against the
// real app in-process: a `connect` override hands the runner sessions from a
// createTestServer instead of dialing a stand, so no URL/PEM is needed.

let server: TestServer<RpcMethods>

beforeAll(async () => {
    server = await createTestServer<RpcMethods>({
        schemaDir,
        schemaLayersDir: layersDir,
        register: app => app.register(demoApp, { serverSeed: 'qa-recipe-seed' }),
    })
})

afterAll(async () => {
    await server.close()
})

describe('demo EOS auth recipes', () => {
    it('signs a new user up, then signs the same key in', async () => {
        const seed = 'qa-alice-seed'
        const report = await runScenario(
            {
                target: { url: 'in-process' },
                users: {
                    // Declaration order matters: sign up first (registers the key),
                    // then sign the same key in on a second connection.
                    signedUp: {
                        auth: {
                            recipe: 'eos-signup',
                            with: { seed, first_name: 'Alice', username: 'alice' },
                        },
                    },
                    signedIn: { auth: { recipe: 'eos-signin', with: { seed } } },
                },
                steps: [
                    // updates.getState requires auth → proves each recipe bound the user.
                    { as: 'signedUp', invoke: 'updates.getState', expect: { _: 'updates.state' } },
                    { as: 'signedIn', invoke: 'updates.getState', expect: { _: 'updates.state' } },
                ],
            },
            { connect: () => server.connect({ layer: 204 }), recipes },
        )

        expect(report.steps.filter(s => !s.ok)).toEqual([])
        expect(report.ok).toBe(true)
    })

    it('eos-auth signs up first, then signs in for a repeat key', async () => {
        const seed = 'qa-bob-seed'
        const report = await runScenario(
            {
                target: { url: 'in-process' },
                users: {
                    first: {
                        auth: { recipe: 'eos-auth', with: { seed, first_name: 'Bob', username: 'bob' } },
                    },
                    second: { auth: { recipe: 'eos-auth', with: { seed } } },
                },
                steps: [
                    { as: 'first', invoke: 'updates.getState', expect: { _: 'updates.state' } },
                    { as: 'second', invoke: 'updates.getState', expect: { _: 'updates.state' } },
                ],
            },
            { connect: () => server.connect(), recipes },
        )

        expect(report.ok).toBe(true)
    })
})
