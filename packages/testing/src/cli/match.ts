import type { TlObject } from '@mt-tl/tl'
import { getByPath, Scope } from './scope.js'

/** A scenario assertion: a bare constructor name, or a map of dotted-path → expected. */
export type Matcher = string | Record<string, unknown>

export interface MatchResult {
    ok: boolean
    mismatches: Array<{ path: string; expected: unknown; actual: unknown }>
}

/**
 * Subset-match `actual` against a {@link Matcher}. A string matches the `_` tag;
 * an object matches each `path: expected` entry (path is dotted into `actual`,
 * `expected` is interpolated against `scope`). Only the listed paths are checked —
 * extra fields on `actual` are ignored — which is what makes one-line `expect`s work.
 */
export function match(matcher: Matcher, actual: TlObject, scope: Scope): MatchResult {
    if (typeof matcher === 'string') {
        const ok = actual?._ === matcher
        return { ok, mismatches: ok ? [] : [{ path: '_', expected: matcher, actual: actual?._ }] }
    }
    const mismatches: MatchResult['mismatches'] = []
    for (const [path, rawExpected] of Object.entries(matcher)) {
        const expected = scope.interpolate(rawExpected)
        const got = getByPath(actual, path)
        if (!deepEqual(got, expected)) mismatches.push({ path, expected, actual: got })
    }
    return { ok: mismatches.length === 0, mismatches }
}

/** Build a predicate from a matcher, for `expectUpdate`. */
export function toUpdatePredicate(matcher: Matcher, scope: Scope): (u: TlObject) => boolean {
    return (u: TlObject) => match(matcher, u, scope).ok
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true
    // Numbers may arrive as bigint from the codec but be authored as plain numbers.
    if (typeof a === 'bigint' || typeof b === 'bigint') {
        try {
            return BigInt(a as never) === BigInt(b as never)
        } catch {
            return false
        }
    }
    if (Buffer.isBuffer(a)) return Buffer.isBuffer(b) ? a.equals(b) : a.toString('hex') === b
    if (typeof a !== typeof b || a == null || b == null) return false
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
        return a.every((x, i) => deepEqual(x, b[i]))
    }
    if (typeof a === 'object') {
        const ak = Object.keys(a as object)
        const bk = Object.keys(b as object)
        if (ak.length !== bk.length) return false
        return ak.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    }
    return false
}
