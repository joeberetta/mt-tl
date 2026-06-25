// Shared value serializers for decoded TL values (BObject/BValue). Kept in their
// own module (no React) so both the per-method try-it panel and the scenario-YAML
// serializer can format params/results the same way — and so scenario-yaml.ts and
// try-it.tsx don't have to import each other.

import type { BObject, BValue } from './client/codec.js'

export const toHex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

/** Pretty JSON for display: bytes → `0x…`, bigint → decimal string. */
export function jsonView(v: BValue): string {
    return JSON.stringify(
        v,
        (_k, val) => (val instanceof Uint8Array ? `0x${toHex(val)}` : typeof val === 'bigint' ? val.toString() : val),
        2,
    )
}

/** Render a decoded value as a YAML scalar/flow node (matches the mt-tl-test scenario
 *  param syntax — bytes via the `!bytes hex:` tag, boxed objects as `{ _: ctor, … }`). */
export function yamlValue(v: BValue): string {
    if (v instanceof Uint8Array) return `!bytes hex:${toHex(v)}`
    if (Array.isArray(v)) {
        if (v.every(x => typeof x === 'number' || typeof x === 'string')) return `[${v.map(yamlValue).join(', ')}]`
        return '\n' + v.map(x => `      - ${yamlValue(x).replace(/\n/g, '\n        ')}`).join('\n')
    }
    if (v && typeof v === 'object' && '_' in v) {
        const o = v as BObject
        const inner = Object.keys(o)
            .filter(k => k !== '_')
            .map(k => `${k}: ${yamlValue(o[k])}`)
            .join(', ')
        return `{ _: ${o._}${inner ? ', ' + inner : ''} }`
    }
    if (typeof v === 'string') return /^[\w.+-]*$/.test(v) ? v : JSON.stringify(v)
    return String(v)
}
