import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { buildApiSpec, type ApiSpec, type SpecSymbol } from '../src/spec.js'

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
    constructors: [
        ctor('aa01', 'demo.profile', 'demo.Profile', [['name', 'string']]),
        ctor('lg01', 'legacy.thing', 'legacy.Thing', [['x', 'int']]),
    ],
    methods: [meth('m001', 'demo.getProfile', 'demo.Profile', [])],
}
const L101 = {
    constructors: [
        ctor('aa02', 'demo.profile', 'demo.Profile', [
            ['first_name', 'string'],
            ['last_name', 'string'],
        ]),
        ctor('lg01', 'legacy.thing', 'legacy.Thing', [['x', 'int']]),
    ],
    methods: [
        meth('m001', 'demo.getProfile', 'demo.Profile', []),
        meth('m101', 'demo.echo', 'demo.EchoResult', [
            ['flags', '#'],
            ['peer', 'InputPeer'],
            ['history', 'Vector<demo.Profile>'],
            ['silent', 'flags.5?true'],
        ]),
    ],
}
const L102 = {
    constructors: [
        ctor('aa03', 'demo.profile', 'demo.Profile', [
            ['first_name', 'string'],
            ['last_name', 'string'],
            ['username', 'string'],
        ]),
    ],
    methods: [
        meth('m102', 'demo.echo', 'demo.EchoResult', [
            ['flags', '#'],
            ['history', 'Vector<demo.Profile>'],
            ['silent', 'flags.5?true'],
            ['effect', 'flags.7?long'],
        ]),
    ],
}

/** Resolve a symbol's shape at a layer from run-length `shapes` (mirrors the studio accessor). */
const shapeAt = (sym: SpecSymbol, layer: number) => {
    const r = sym.shapes.find(x => layer >= x.from && layer <= x.to)
    return r ? { id: r.id, layer, params: r.params } : undefined
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
        expect(shapeAt(p, 100)!.params.map(x => x.name)).toEqual(['name'])
        expect(shapeAt(p, 102)!.params.map(x => x.name)).toEqual(['first_name', 'last_name', 'username'])
        // `name` existed only at 100 → removed from the latest shape.
        const name100 = shapeAt(p, 100)!.params[0]!
        expect([name100.since, name100.until, name100.removed]).toEqual([100, 100, true])
        const uname = shapeAt(p, 102)!.params.find(x => x.name === 'username')!
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
        const peer = shapeAt(echo, 101)!.params.find(x => x.name === 'peer')!
        expect([peer.since, peer.until, peer.removed, peer.ref]).toEqual([101, 101, true, 'InputPeer'])
        const effect = shapeAt(echo, 102)!.params.find(x => x.name === 'effect')!
        expect([effect.since, effect.removed, effect.optional, effect.flagBit]).toEqual([102, false, true, 7])
        const history = shapeAt(echo, 102)!.params.find(x => x.name === 'history')!
        expect(history.ref).toBe('demo.Profile') // vector inner, unwrapped
    })
})

describe('buildApiSpec — run-length shapes', () => {
    it('stamps the format version', () => {
        expect(spec.version).toBe(2)
    })

    it('collapses a symbol unchanged across layers into a single run', () => {
        // legacy.thing has the SAME id (lg01) at 100 and 101 → one run, not two.
        const t = spec.constructors['legacy.thing']!
        expect(t.shapes).toHaveLength(1)
        expect([t.shapes[0]!.id, t.shapes[0]!.from, t.shapes[0]!.to]).toEqual(['lg01', 100, 101])
    })

    it('keeps one run per distinct shape for a symbol that changes every layer', () => {
        // demo.profile: aa01@100, aa02@101, aa03@102 → three runs.
        const p = spec.constructors['demo.profile']!
        expect(p.shapes.map(r => [r.id, r.from, r.to])).toEqual([
            ['aa01', 100, 100],
            ['aa02', 101, 101],
            ['aa03', 102, 102],
        ])
    })

    it('splits runs across a presence gap (present → absent → present), same id', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mttl-spec-gap-'))
        const gap = ctor('g1', 'demo.gap', 'demo.Gap', [['x', 'int']])
        writeFileSync(join(dir, 'scheme_100.json'), JSON.stringify({ constructors: [gap], methods: [] }))
        writeFileSync(join(dir, 'scheme_101.json'), JSON.stringify({ constructors: [ctor('o1', 'demo.other', 'demo.Other', [])], methods: [] }))
        writeFileSync(join(dir, 'scheme_102.json'), JSON.stringify({ constructors: [gap], methods: [] }))
        const g = buildApiSpec(dir).constructors['demo.gap']!
        // two runs despite identical id — 101 is a hole the symbol falls through.
        expect(g.shapes.map(r => [r.from, r.to])).toEqual([
            [100, 100],
            [102, 102],
        ])
        expect(shapeAt(g, 101)).toBeUndefined()
        expect([shapeAt(g, 100)!.id, shapeAt(g, 102)!.id]).toEqual(['g1', 'g1'])
    })

    it('treats a numbering gap as adjacent (layer 101 never shipped) → one run', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mttl-spec-nogap-'))
        const stable = ctor('s1', 'demo.stable', 'demo.Stable', [['x', 'int']])
        writeFileSync(join(dir, 'scheme_100.json'), JSON.stringify({ constructors: [stable], methods: [] }))
        writeFileSync(join(dir, 'scheme_102.json'), JSON.stringify({ constructors: [stable], methods: [] }))
        const s = buildApiSpec(dir)
        expect(s.layers).toEqual([100, 102])
        const st = s.constructors['demo.stable']!
        expect(st.shapes).toHaveLength(1)
        expect([st.shapes[0]!.from, st.shapes[0]!.to]).toEqual([100, 102])
    })
})

describe('buildApiSpec — protocol is hidden from the docs', () => {
    it('drops low-level protocol types but keeps the public wrappers + business', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mttl-spec-proto-'))
        writeFileSync(
            join(dir, 'scheme_300.json'),
            JSON.stringify({
                constructors: [
                    ctor('aa01', 'demo.thing', 'demo.Thing', [['x', 'int']]),
                    ctor('2144ca19', 'rpc_error', 'RpcError', [['error_code', 'int']]),
                    ctor('1cb5c415', 'vector', 'Vector', []),
                ],
                methods: [
                    meth('b001', 'demo.do', 'demo.Thing', []),
                    meth('7abe77ec', 'ping', 'Pong', [['ping_id', 'long']]),
                    meth('da9b0d0d', 'invokeWithLayer', 'X', [['layer', 'int']]), // wrapper → kept
                ],
            }),
        )
        const s = buildApiSpec(dir)

        // Business + the public wrappers survive…
        expect(Object.keys(s.constructors)).toContain('demo.thing')
        expect(Object.keys(s.methods)).toEqual(expect.arrayContaining(['demo.do', 'invokeWithLayer']))
        // …low-level protocol plumbing is gone (incl. its types).
        expect(s.constructors).not.toHaveProperty('rpc_error')
        expect(s.constructors).not.toHaveProperty('vector')
        expect(s.methods).not.toHaveProperty('ping')
        expect(s.types).not.toHaveProperty('RpcError')
        expect(s.types).not.toHaveProperty('Vector')
    })
})
