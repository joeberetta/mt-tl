import { describe, it, expect } from 'vitest'
import { jsonView } from '../src/value-format.js'

// Regression: a captured TL `long` (e.g. an authorization hash) decodes to a BigInt,
// which raw JSON.stringify rejects. The scenario runner's capture log used to crash
// ("cannot serialize BigInt") on `JSON.stringify(scope.get(key))`; it now goes through
// jsonView, which must render bigints as decimal strings (and bytes as 0x hex).
describe('jsonView — bigint/bytes safe', () => {
    it('renders a top-level bigint as a decimal string instead of throwing', () => {
        expect(jsonView(7369575312761356819n)).toBe('"7369575312761356819"')
    })

    it('renders bigints nested in an object without throwing', () => {
        const out = jsonView({ _: 'authorization', hash: 7369575312761356819n, current: true })
        expect(out).toContain('"7369575312761356819"')
        expect(() => JSON.parse(out)).not.toThrow()
    })

    it('renders bytes as 0x hex', () => {
        expect(jsonView(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('"0xdeadbeef"')
    })
})
