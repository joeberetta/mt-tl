import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect } from 'vitest'
import { loadLayeredRegistry, LayeredRegistry } from '../src/tl/layered-registry.js'
import { loadSchema } from '../src/tl/registry.js'
import { TlCodec } from '../src/tl/codec.js'
import { renderUpdateForLayer } from '../src/updates/render.js'
import type { TlDef } from '@mt-tl/tl'
import type { TlObject } from '@mt-tl/tl'

const layered = loadLayeredRegistry(layersDir)

describe('LayeredRegistry (real snapshots 203/204)', () => {
    // The two demo snapshots differ by exactly one predicate: layer 204 adds
    // `crypto.updateNewBalance#eb8da021` (absent at 203).
    it('resolves a predicate present only at the newer layer', () => {
        expect(layered.resolve('crypto.updateNewBalance', 204)?.id).toBe('eb8da021')
        expect(layered.resolve('crypto.updateNewBalance', 203)).toBeUndefined()
    })

    it('floors the requested layer to the nearest available snapshot', () => {
        expect(layered.resolveLayer(204)).toBe(204)
        expect(layered.resolveLayer(203)).toBe(203)
        expect(layered.resolveLayer(250)).toBe(204) // above max -> newest available
        expect(layered.resolveLayer(100)).toBe(203) // below min -> smallest
    })

    it('reports representability per layer (new-only predicate)', () => {
        expect(layered.representable({ _: 'crypto.updateNewBalance' }, 204)).toBe(true)
        expect(layered.representable({ _: 'crypto.updateNewBalance' }, 203)).toBe(false)
    })

    it('reports a container unrepresentable when a nested predicate is missing', () => {
        const upd: TlObject = {
            _: 'updateShort',
            update: { _: 'crypto.updateNewBalance', pts: 1 },
            date: 1,
        }
        expect(layered.representable(upd, 204)).toBe(true)
        expect(layered.representable(upd, 203)).toBe(false) // crypto.updateNewBalance absent at 203
    })
})

describe('decode-union — older-layer ids resolve', () => {
    // The real 203/204 snapshots differ only by an *added* predicate, so the
    // "same name, two constructor ids across layers" case is exercised with a
    // synthetic registry: base schema = newest id; the layered union adds the
    // older-layer-only id so the decode (by-id) path can still resolve it.
    const synth = new LayeredRegistry()
    synth.addLayer(203, [def('xprofile', 'ecd75d8c')])
    synth.addLayer(204, [def('xprofile', '005ccac9')])
    const { registry } = loadSchema([protocolSchemaDir, schemaDir])
    registry.register(def('xprofile', '005ccac9'))
    for (const d of synth.allDefs()) registry.register(d)

    it('resolves an old-layer-only constructor id by id (decode path)', () => {
        const oldDef = registry.getById(0xecd75d8c)
        expect(oldDef?.name).toBe('xprofile')
        expect(oldDef?.id).toBe('ecd75d8c')
    })

    it('keeps the newest id for the name (encode path unaffected)', () => {
        expect(registry.getByName('xprofile')?.id).toBe('005ccac9')
    })

    it('round-trips a value encoded at an old layer through decode', () => {
        const codec = new TlCodec(registry, layered)
        const v = { _: 'updateUnsupported', pts: 7, pts_count: 2 }
        const decoded = codec.decode(codec.encode(v, 203)) as TlObject
        expect(decoded._).toBe('updateUnsupported')
        expect(decoded.pts).toBe(7)
    })
})

describe('TlCodec — layer-aware constructor id', () => {
    const { registry } = loadSchema([protocolSchemaDir, schemaDir])

    it('writes the constructor id valid for the encode layer', () => {
        const synth = new LayeredRegistry()
        synth.addLayer(100, [def('foo', 'aaaaaaaa')])
        synth.addLayer(200, [def('foo', 'bbbbbbbb')])
        const codec = new TlCodec(registry, synth)

        expect(codec.encode({ _: 'foo', x: 7 }, 100).subarray(0, 4).toString('hex')).toBe('aaaaaaaa')
        expect(codec.encode({ _: 'foo', x: 7 }, 200).subarray(0, 4).toString('hex')).toBe('bbbbbbbb')
    })
})

describe('renderUpdateForLayer — updateUnsupported substitution', () => {
    const reg = new LayeredRegistry()
    // layer 100 knows updateA; layer 200 also knows updateB.
    reg.addLayer(100, [
        def('updateA', '11111111'),
        def('updateUnsupported', 'db10bf20'),
        def('updateShort', '78d4dec1'),
    ])
    reg.addLayer(200, [
        def('updateA', '11111111'),
        def('updateB', '22222222'),
        def('updateUnsupported', 'db10bf20'),
        def('updateShort', '78d4dec1'),
    ])

    it('passes through a representable update', () => {
        expect(renderUpdateForLayer({ _: 'updateA' }, 100, reg)).toEqual({ _: 'updateA' })
    })

    it('substitutes a pts-bearing unrepresentable update with updateUnsupported', () => {
        const out = renderUpdateForLayer({ _: 'updateB', pts: 42, pts_count: 3 }, 100, reg)
        expect(out).toEqual({ _: 'updateUnsupported', pts: 42, pts_count: 3 })
    })

    it('drops an ephemeral (no-pts) unrepresentable update', () => {
        expect(renderUpdateForLayer({ _: 'updateB' }, 100, reg)).toBeNull()
    })

    it('substitutes inside an updateShort container', () => {
        const out = renderUpdateForLayer(
            { _: 'updateShort', update: { _: 'updateB', pts: 9, pts_count: 1 }, date: 5 },
            100,
            reg,
        )
        expect(out).toEqual({
            _: 'updateShort',
            update: { _: 'updateUnsupported', pts: 9, pts_count: 1 },
            date: 5,
        })
    })

    it('keeps it as-is at a layer that supports it', () => {
        const upd: TlObject = { _: 'updateB', pts: 9, pts_count: 1 }
        expect(renderUpdateForLayer(upd, 200, reg)).toEqual(upd)
    })
})

function def(name: string, id: string): TlDef {
    return {
        id,
        idNum: parseInt(id, 16) >>> 0,
        name,
        kind: 'constructor',
        params: [{ name: 'x', raw: 'int', type: { kind: 'int' } }],
        type: name.startsWith('update') ? 'Update' : 'Foo',
        isProtocol: false,
    }
}
