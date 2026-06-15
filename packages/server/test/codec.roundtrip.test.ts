import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { protocolSchemaDir } from '@mt-tl/tl'
import { describe, it, expect } from 'vitest'
import { loadSchema } from '../src/tl/registry.js'
import { parseSchemaDir } from '@mt-tl/tl'
import { TlCodec } from '../src/tl/codec.js'
import type { TlDef, TlParam, TlType } from '@mt-tl/tl'
import type { TlObject, TlValue } from '@mt-tl/tl'

const { registry, constructors, methods } = loadSchema([protocolSchemaDir, schemaDir])
const codec = new TlCodec(registry)

// Precompute defs + indexes once (the registry intentionally has no iterator).
const allDefs: TlDef[] = (() => {
    const seen = new Set<string>()
    const out: TlDef[] = []
    for (const def of parseSchemaDir(schemaDir).defs) {
        if (seen.has(def.id)) continue
        seen.add(def.id)
        out.push(def)
    }
    return out
})()
const byName = new Map<string, TlDef>()
for (const d of allDefs) if (!byName.has(d.name)) byName.set(d.name, d)
// Only map a type to a constructor that is canonical-by-name, so that building a
// nested value and re-serializing it by name resolve to the same def.
const ctorOfType = new Map<string, TlDef>()
for (const d of allDefs) {
    if (d.kind !== 'constructor' || ctorOfType.has(d.type)) continue
    if (byName.get(d.name) === d) ctorOfType.set(d.type, d)
}

describe('schema load', () => {
    it('parses a large schema', () => {
        // The demo schema is trimmed to the methods the app + framework actually
        // dispatch, so these are lower bounds, not the full Telegram surface.
        expect(constructors).toBeGreaterThan(500)
        expect(methods).toBeGreaterThan(150)
    })
})

describe('codec — primitive and structural round-trips', () => {
    it('round-trips int128/string/Vector<long>', () => {
        const value: TlObject = {
            _: 'resPQ',
            nonce: Buffer.alloc(16, 0xab),
            server_nonce: Buffer.alloc(16, 0xcd),
            pq: 'pqbytes',
            server_public_key_fingerprints: [1n, 2n, 0xffffffffffffffffn],
        }
        const decoded = codec.decode(codec.encode(value)) as TlObject
        expect(decoded._).toBe('resPQ')
        expect((decoded.nonce as Buffer).equals(Buffer.alloc(16, 0xab))).toBe(true)
        expect(decoded.pq).toBe('pqbytes')
        expect(decoded.server_public_key_fingerprints).toEqual([1n, 2n, 0xffffffffffffffffn])
    })

    it('round-trips optional (flags) fields present and absent', () => {
        const present: TlObject = {
            _: 'initConnection',
            api_id: 42,
            api_hash: 'secret',
            device_model: 'pc',
            system_version: '1',
            app_version: '1',
            system_lang_code: 'en',
            lang_pack: '',
            lang_code: 'en',
            query: { _: 'help.getServerConfig' },
        }
        const d1 = codec.decode(codec.encode(present)) as TlObject
        expect(d1.api_hash).toBe('secret')
        expect((d1.query as TlObject)._).toBe('help.getServerConfig')

        const absent: TlObject = { ...present }
        delete (absent as Record<string, unknown>).api_hash
        const d2 = codec.decode(codec.encode(absent)) as TlObject
        expect(d2.api_hash).toBeUndefined()
    })
})

describe('codec — full constructor sweep (encode/decode/encode stable)', () => {
    it('round-trips a large fraction of constructors', () => {
        let covered = 0
        let skipped = 0
        const failures: string[] = []

        for (const def of allDefs) {
            if (def.kind !== 'constructor') continue
            if (def.idNum === 0x1cb5c415) continue // the Vector marker, handled specially
            // Skip non-canonical name duplicates (same predicate at different layers):
            // the codec serializes results by name and resolves to the first registration,
            // so building a non-canonical variant is a test artifact, not a codec issue.
            if (byName.get(def.name) !== def) continue
            let sample: TlObject
            try {
                sample = buildSample(def, 6)
            } catch (e) {
                if (e instanceof SkipError) {
                    skipped++
                    continue
                }
                failures.push(`${def.name}: build ${(e as Error).message}`)
                continue
            }
            try {
                const a = codec.encode(sample)
                const decoded = codec.decode(a) as TlObject
                const b = codec.encode(decoded)
                if (!a.equals(b)) failures.push(`${def.name}: e/d/e mismatch`)
                else covered++
            } catch (e) {
                failures.push(`${def.name}: ${(e as Error).message}`)
            }
        }

        if (failures.length) {
            throw new Error(
                `${failures.length} failures (covered=${covered}, skipped=${skipped}):\n` +
                    failures.slice(0, 40).join('\n'),
            )
        }
        expect(covered).toBeGreaterThan(500)
    })
})

// --- helpers ---------------------------------------------------------------

class SkipError extends Error {}

function buildSample(def: TlDef, depth: number): TlObject {
    if (depth < 0) throw new SkipError('depth')
    const obj: TlObject = { _: def.name }
    // Group conditional fields by (flagsField, bit): fields sharing a bit are
    // coupled on the wire, so set them all-or-nothing.
    const byBit = new Map<string, TlParam[]>()
    for (const p of def.params) {
        if (p.type.kind === 'flags') continue
        if (p.type.kind === 'flag') {
            const key = `${p.type.flagsField}.${p.type.bit}`
            const list = byBit.get(key) ?? []
            list.push(p)
            byBit.set(key, list)
            continue
        }
        obj[p.name] = sampleType(p.type, depth - 1)
    }
    if (depth >= 2) {
        for (const group of byBit.values()) {
            const built: Array<[string, TlValue]> = []
            let ok = true
            for (const p of group) {
                if (p.type.kind !== 'flag') continue
                if (p.type.inner.kind === 'true') {
                    built.push([p.name, true])
                } else {
                    try {
                        built.push([p.name, sampleType(p.type.inner, depth - 1)])
                    } catch (e) {
                        if (e instanceof SkipError) {
                            ok = false
                            break
                        }
                        throw e
                    }
                }
            }
            if (ok) for (const [name, val] of built) obj[name] = val
        }
    }
    return obj
}

function sampleType(t: TlType, depth: number): TlValue {
    switch (t.kind) {
        case 'int':
            return 7
        case 'long':
            return 123n
        case 'double':
            return 3.5
        case 'string':
            return 'sample'
        case 'bytes':
            return Buffer.from([1, 2, 3, 4, 5])
        case 'int128':
            return Buffer.alloc(16, 0x11)
        case 'int256':
            return Buffer.alloc(32, 0x22)
        case 'bool':
            return true
        case 'true':
            return true
        case 'flags':
            return 0
        case 'vector': {
            if (depth < 1) return []
            try {
                return [sampleType(t.inner, depth - 1)]
            } catch (e) {
                if (e instanceof SkipError) return []
                throw e
            }
        }
        case 'boxed': {
            const ctor = ctorOfType.get(t.name)
            if (!ctor) throw new SkipError(`no ctor for ${t.name}`)
            return buildSample(ctor, depth - 1)
        }
        case 'bare': {
            const def = byName.get(t.name)
            if (!def) throw new SkipError(`no def ${t.name}`)
            return buildSample(def, depth - 1)
        }
        case 'object':
            throw new SkipError('generic object')
        case 'flag':
            throw new SkipError('flag')
    }
}
