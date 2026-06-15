import { describe, it, expect } from 'vitest'
import { Scope, match } from '../src/cli/index.js'

describe('Scope interpolation', () => {
    it('resolves dotted paths; a whole ${ref} keeps the raw type', () => {
        const s = new Scope({ greeting: 'hi', bob: { id: 42 } })
        expect(s.interpolate('${greeting} bob')).toBe('hi bob')
        expect(s.interpolate('${bob.id}')).toBe(42) // number preserved, not "42"
        expect(s.interpolate({ a: '${bob.id}', b: ['${greeting}'] })).toEqual({ a: 42, b: ['hi'] })
    })

    it('leaves an unresolved ref verbatim, and does not re-resolve nested refs', () => {
        expect(new Scope().interpolate('${nope} x')).toBe('${nope} x')
        // single-pass: a var whose value contains ${...} stays literal (keeps a
        // capture/match deterministic when it embeds a generator like ${now}).
        expect(new Scope({ msg: 'hi ${now}' }).interpolate('${msg}')).toBe('hi ${now}')
    })

    it('captures via set() and reads them back', () => {
        const s = new Scope()
        s.set('bob.access_hash', 12345n)
        expect(s.get('bob.access_hash')).toBe(12345n)
        expect(s.interpolate('${bob.access_hash}')).toBe(12345n)
    })

    it('generates fresh dynamic tokens', () => {
        const s = new Scope()
        expect(typeof s.get('rand.long')).toBe('bigint')
        expect(s.get('rand.long')).not.toBe(s.get('rand.long')) // fresh each read
        expect(typeof s.get('now')).toBe('number')
        expect(s.get('uuid')).toMatch(/^[0-9a-f]{32}$/)
    })

    it('supports custom generators (fresh each use, win over built-ins)', () => {
        let n = 0
        const s = new Scope({}, { seq: () => ++n, uuid: () => 'FIXED' })
        expect(s.interpolate('${seq}-${seq}')).toBe('1-2') // fresh each interpolation
        expect(s.interpolate('${uuid}')).toBe('FIXED') // custom overrides the built-in uuid
    })
})

describe('match (subset/dotted)', () => {
    const scope = new Scope({ who: 'bob' })
    it('matches the _ tag and dotted paths, interpolating expected values', () => {
        const updates = {
            _: 'updates',
            updates: [{ _: 'updateNewMessage', message: { message: 'hi bob' } }],
        } as never
        expect(match('updates', updates, scope).ok).toBe(true)
        expect(match({ 'updates.0.message.message': 'hi bob' }, updates, scope).ok).toBe(true)
        expect(match({ 'updates.0.message.message': 'nope' }, updates, scope).ok).toBe(false)
    })
})
