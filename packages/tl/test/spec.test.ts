import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { buildApiSpec, type ApiSpec } from '../src/spec.js'

// Three synthetic layer snapshots exercising the full lifecycle:
//   demo.profile : name(100) → first_name+last_name(101) → +username(102)   [field add + field remove via rename]
//   demo.getProfile : present 100,101 → removed at 102                      [method removed]
//   legacy.thing / legacy.Thing : present 100,101 → removed at 102          [type removed]
//   demo.echo : introduced 101; peer removed + effect added at 102          [field removed + field added]
const ctor = (id: string, predicate: string, type: string, params: [string, string][]) => ({
    id,
    predicate,
    type,
    params: params.map(([name, t]) => ({ name, type: t })),
})
const meth = (id: string, method: string, type: string, params: [string, string][]) => ({
    id,
    method,
    type,
    params: params.map(([name, t]) => ({ name, type: t })),
})

const L100 = {
    constructors: [ctor('aa01', 'demo.profile', 'demo.Profile', [['name', 'string']]), ctor('lg01', 'legacy.thing', 'legacy.Thing', [['x', 'int']])],
    methods: [meth('m001', 'demo.getProfile', 'demo.Profile', [])],
}
const L101 = {
    constructors: [
        ctor('aa02', 'demo.profile', 'demo.Profile', [['first_name', 'string'], ['last_name', 'string']]),
        ctor('lg01', 'legacy.thing', 'legacy.Thing', [['x', 'int']]),
    ],
    methods: [
        meth('m001', 'demo.getProfile', 'demo.Profile', []),
        meth('m101', 'demo.echo', 'demo.EchoResult', [['flags', '#'], ['peer', 'InputPeer'], ['history', 'Vector<demo.Profile>'], ['silent', 'flags.5?true']]),
    ],
}
const L102 = {
    constructors: [ctor('aa03', 'demo.profile', 'demo.Profile', [['first_name', 'string'], ['last_name', 'string'], ['username', 'string']])],
    methods: [meth('m102', 'demo.echo', 'demo.EchoResult', [['flags', '#'], ['history', 'Vector<demo.Profile>'], ['silent', 'flags.5?true'], ['effect', 'flags.7?long']])],
}

let spec: ApiSpec
beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'mttl-spec-'))
    writeFileSync(join(dir, 'scheme_100.json'), JSON.stringify(L100))
    writeFileSync(join(dir, 'scheme_101.json'), JSON.stringify(L101))
    writeFileSync(join(dir, 'scheme_102.json'), JSON.stringify(L102))
    spec = buildApiSpec(dir)
})

describe('buildApiSpec — layer awareness', () => {
    it('lists layers ascending with the latest', () => {
        expect(spec.layers).toEqual([100, 101, 102])
        expect(spec.latestLayer).toBe(102)
    })

    it('keeps a per-layer shape for a symbol that changed, with field since/until', () => {
        const p = spec.constructors['demo.profile']!
        expect([p.sinceLayer, p.lastLayer, p.removed]).toEqual([100, 102, false])
        expect(p.byLayer[100]!.params.map(x => x.name)).toEqual(['name'])
        expect(p.latest.params.map(x => x.name)).toEqual(['first_name', 'last_name', 'username'])
        // `name` existed only at 100 → removed from the latest shape.
        const name100 = p.byLayer[100]!.params[0]!
        expect([name100.since, name100.until, name100.removed]).toEqual([100, 100, true])
        const uname = p.latest.params.find(x => x.name === 'username')!
        expect([uname.since, uname.removed]).toEqual([102, false])
    })

    it('marks a removed method with the layer it disappeared', () => {
        const g = spec.methods['demo.getProfile']!
        expect([g.sinceLayer, g.lastLayer, g.removed, g.removedIn]).toEqual([100, 101, true, 102])
        expect(spec.methods['demo.echo']!.removed).toBe(false)
    })

    it('marks a removed type', () => {
        const t = spec.types['legacy.Thing']!
        expect([t.sinceLayer, t.lastLayer, t.removed, t.removedIn]).toEqual([100, 101, true, 102])
        expect(t.constructors).toEqual(['legacy.thing'])
        const profile = spec.types['demo.Profile']!
        expect([profile.lastLayer, profile.removed]).toEqual([102, false])
    })

    it('tracks a field removed and a field added on the same symbol', () => {
        const echo = spec.methods['demo.echo']!
        const peer = echo.byLayer[101]!.params.find(x => x.name === 'peer')!
        expect([peer.since, peer.until, peer.removed, peer.ref]).toEqual([101, 101, true, 'InputPeer'])
        const effect = echo.latest.params.find(x => x.name === 'effect')!
        expect([effect.since, effect.removed, effect.optional, effect.flagBit]).toEqual([102, false, true, 7])
        const history = echo.latest.params.find(x => x.name === 'history')!
        expect(history.ref).toBe('demo.Profile') // vector inner, unwrapped
    })
})
