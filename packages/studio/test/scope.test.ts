import { describe, it, expect } from 'vitest'
import { Scope } from '../src/client/scope.js'

describe('Scope — ${...} interpolation', () => {
    it('${rand.long} → a positive bigint, fresh each call', () => {
        const s = new Scope()
        const a = s.interpolate('${rand.long}')
        const b = s.interpolate('${rand.long}')
        expect(typeof a).toBe('bigint')
        expect(a as bigint).toBeGreaterThanOrEqual(0n)
        expect(a).not.toBe(b) // astronomically unlikely to collide
    })

    it('a sole ${path} yields the RAW value; embedded splices as text', () => {
        const s = new Scope({ user: { id: 42 } })
        expect(s.interpolate('${user.id}')).toBe(42)
        expect(s.interpolate('id=${user.id}')).toBe('id=42')
    })

    it('captured values (set) are referenceable later', () => {
        const s = new Scope()
        s.set('alice.id', 7)
        expect(s.interpolate('${alice.id}')).toBe(7)
        expect(s.interpolate('${missing.key}')).toBe('${missing.key}') // unresolved left verbatim
    })

    it('recurses objects/arrays, leaves binary alone', () => {
        const s = new Scope({ x: 'X' })
        const bin = new Uint8Array([1, 2, 3])
        const r = s.interpolate({ a: '${x}', b: [1, '${x}'], c: bin }) as Record<string, unknown>
        expect(r.a).toBe('X')
        expect((r.b as unknown[])[1]).toBe('X')
        expect(r.c).toBe(bin) // not mangled into a plain object
    })

    it('supports custom generators (fresh each use, win over built-ins) — parity with cli/scope.ts', () => {
        let n = 0
        const s = new Scope({}, { seq: () => ++n, uuid: () => 'FIXED' })
        expect(s.interpolate('${seq}-${seq}')).toBe('1-2') // fresh each interpolation
        expect(s.interpolate('${uuid}')).toBe('FIXED') // custom overrides the built-in uuid
    })
})
