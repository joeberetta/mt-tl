import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'
import { validateScenario } from '@mt-tl/testing/cli'
import {
    toYaml,
    fromScenario,
    emptyStep,
    emptyUser,
    scenarioStep,
    wrapScenario,
    type User,
    type Step,
    type ScenarioState,
} from '../src/scenario-yaml.js'

// The studio's scenario serializer must round-trip through @mt-tl/testing's CANONICAL
// `validateScenario` — i.e. a studio-built/exported YAML loads as a valid mt-tl-test
// scenario. These tests pin the shared contract (steps invoke|expectUpdate|recipe,
// multi-field matchers, expectError {code,message}, per-user auth recipe|steps,
// top-level vars, target schema/publicKey placeholders).

let id = 0
const nid = (): number => ++id
const mkStep = (over: Partial<Step>): Step => ({ ...emptyStep(over.as ?? 'alice', nid), ...over })

function sampleState(): ScenarioState {
    const alice: User = { ...emptyUser('alice', nid), layer: '204', authMode: 'recipe', recipe: 'eos-login', with: '{"seed":"abc"}' }
    const bob: User = {
        ...emptyUser('bob', nid),
        authMode: 'steps',
        authSteps: [mkStep({ as: 'bob', kind: 'invoke', method: 'crypto.sendCode', value: { _: 'crypto.sendCode', api_id: 1, api_hash: 'x' }, expect: 'dataJSON' })],
    }
    const nyx: User = emptyUser('nyx', nid) // anonymous
    return {
        url: 'ws://localhost:9000',
        vars: '{"tag":"hello"}',
        users: [alice, bob, nyx],
        steps: [
            mkStep({ as: 'alice', kind: 'invoke', method: 'crypto.sendCode', value: { _: 'crypto.sendCode', api_id: 1001, api_hash: '${tag}' }, expect: 'dataJSON', matchSpec: 'data = ${tag}', capture: 'alice.echo = data' }),
            mkStep({ as: 'nyx', kind: 'invoke', method: 'updates.getState', value: { _: 'updates.getState' }, expectMode: 'error', expect: '401', errorMessage: 'AUTH_KEY_INVALID' }),
            mkStep({ as: 'alice', kind: 'expectUpdate', expect: 'updateShort', matchSpec: 'update.wallet_id = w1', timeoutSec: '2' }),
            mkStep({ as: 'bob', kind: 'recipe', recipe: 'warmup', with: '{"k":1}' }),
        ],
    }
}

describe('scenario-yaml ⇄ @mt-tl/testing validateScenario', () => {
    it('exports YAML that validates as a canonical mt-tl-test scenario', () => {
        const yaml = toYaml(sampleState())
        const parsed = parse(yaml)
        expect(() => validateScenario(parsed)).not.toThrow()

        // target carries CLI-runnable placeholders (d).
        expect(parsed.target.url).toBe('ws://localhost:9000')
        expect(parsed.target.schema).toBe('./schema')
        expect(parsed.target.publicKey).toBe('./server.pub')
        // top-level vars (e).
        expect(parsed.vars).toEqual({ tag: 'hello' })
    })

    it('serializes per-user auth (recipe + with) and inline auth.steps + anonymous (b)', () => {
        const parsed = parse(toYaml(sampleState()))
        expect(parsed.users.alice).toEqual({ layer: 204, auth: { recipe: 'eos-login', with: { seed: 'abc' } } })
        expect(parsed.users.bob.auth.steps).toHaveLength(1)
        expect(parsed.users.bob.auth.steps[0].invoke).toBe('crypto.sendCode')
        expect(parsed.users.nyx).toEqual({}) // anonymous → empty user spec
    })

    it('emits multi-field matchers, expectError {code,message}, recipe steps + capture (c)', () => {
        const steps = parse(toYaml(sampleState())).steps as any[]
        const invoke = steps.find(s => s.invoke === 'crypto.sendCode')
        expect(invoke.expect).toEqual({ _: 'dataJSON', data: '${tag}' }) // multi-field match
        expect(invoke.capture).toEqual({ 'alice.echo': 'data' })

        const err = steps.find(s => s.expectError)
        expect(err.expectError).toEqual({ code: 401, message: 'AUTH_KEY_INVALID' })

        const upd = steps.find(s => s.expectUpdate)
        expect(upd.expectUpdate).toEqual({ _: 'updateShort', 'update.wallet_id': 'w1' })
        expect(upd.timeoutMs).toBe(2000)

        const recipe = steps.find(s => s.recipe)
        expect(recipe).toMatchObject({ recipe: 'warmup', with: { k: 1 } })
    })

    it('masks auth `with` secrets in the export artifact, keeps them in the live preview', () => {
        const live = parse(toYaml(sampleState()))
        const masked = parse(toYaml(sampleState(), true))
        expect(live.users.alice.auth.with).toEqual({ seed: 'abc' })
        expect(masked.users.alice.auth.with).toEqual({ seed: 'your seed' })
    })

    it('round-trips: fromScenario(toYaml(state)) preserves the shape', () => {
        const state = sampleState()
        const back = fromScenario(toYaml(state), nid)
        expect(back.vars).toBe('{"tag":"hello"}')
        expect(back.users.map(u => u.name)).toEqual(['alice', 'bob', 'nyx'])
        expect(back.users[0]!.authMode).toBe('recipe')
        expect(back.users[1]!.authMode).toBe('steps')
        expect(back.users[1]!.authSteps).toHaveLength(1)
        expect(back.users[2]!.authMode).toBe('anonymous')
        expect(back.steps).toHaveLength(4)
        const err = back.steps.find(s => s.expectMode === 'error')!
        expect(err.expect).toBe('401')
        expect(err.errorMessage).toBe('AUTH_KEY_INVALID')
        const upd = back.steps.find(s => s.kind === 'expectUpdate')!
        expect(upd.matchSpec).toBe('update.wallet_id = w1')
        expect(back.steps.find(s => s.kind === 'recipe')!.recipe).toBe('warmup')
    })

    it('per-method try-it emits a canonical inline step + a runnable scenario', () => {
        const value = { _: 'crypto.sendCode', api_id: 1, api_hash: 'qa' }
        const step = scenarioStep('crypto.sendCode', value, 'auth.SentCode')
        expect(step).toBe('- { invoke: crypto.sendCode, params: { api_id: 1, api_hash: qa }, expect: { _: auth.SentCode } }')
        // The inline step pastes into a steps list and validates.
        expect(() => validateScenario(parse(`target: { url: ws://x }\nsteps:\n    ${step}`))).not.toThrow()
        // The download wraps it into a complete, CLI-runnable scenario.
        const full = parse(wrapScenario('ws://x', 'crypto.sendCode', value, 'auth.SentCode'))
        expect(() => validateScenario(full)).not.toThrow()
        expect(full.target).toEqual({ url: 'ws://x', schema: './schema', publicKey: './server.pub' })
        expect(full.steps[0].invoke).toBe('crypto.sendCode')
    })
})
