/**
 * Intermediate representation (IR) for the TL schema.
 *
 * A `.tl` file is parsed into a flat list of {@link TlDef} (constructors and
 * methods). Each parameter's textual type is parsed once, at load time, into a
 * structured {@link TlType} so the generic codec can walk it without re-parsing
 * strings on every (de)serialization.
 */

export type TlType =
    | { kind: 'int' } // 4 bytes LE -> number
    | { kind: 'long' } // 8 bytes LE -> bigint
    | { kind: 'double' } // 8 bytes IEEE754 LE -> number
    | { kind: 'string' } // length-prefixed utf-8 -> string
    | { kind: 'bytes' } // length-prefixed raw -> Buffer
    | { kind: 'int128' } // 16 raw bytes -> Buffer
    | { kind: 'int256' } // 32 raw bytes -> Buffer
    | { kind: 'bool' } // boxed Bool -> boolean
    | { kind: 'true' } // bare `true`, only as a flag presence marker -> boolean
    | { kind: 'flags' } // the `#` bitmask field
    | { kind: 'flag'; flagsField: string; bit: number; inner: TlType } // conditional field
    | { kind: 'vector'; boxed: boolean; inner: TlType }
    | { kind: 'object' } // `Object` / `!X` / `X` — a nested boxed object (read its ctor id)
    | { kind: 'boxed'; name: string } // a named polymorphic type — read/write with ctor id
    | { kind: 'bare'; name: string } // a named bare constructor (`%X` / lowercase) — no ctor id

export interface TlParam {
    name: string
    /** Original textual type, kept for diagnostics / crc. */
    raw: string
    type: TlType
}

export interface TlDef {
    /** 8-char lowercase hex constructor id. */
    id: string
    /** Unsigned 32-bit numeric form of {@link id}. */
    idNum: number
    /** predicate (constructor) or method name, e.g. `dust.getConfig`. */
    name: string
    kind: 'constructor' | 'method'
    params: TlParam[]
    /** Boxed result/return type, e.g. `dust.CalculatedExchange`. */
    type: string
    /** True for the immutable MTProto protocol layer (scheme_0_protocol + core). */
    isProtocol: boolean
}

const PRIMITIVES = new Set(['int', 'long', 'double', 'string', 'bytes', 'int128', 'int256', 'Bool', 'true'])

export function parseType(raw: string): TlType {
    const t = raw.trim()

    if (t === '#') return { kind: 'flags' }

    // conditional field: <flagsField>.<bit>?<inner>, e.g. api_hash:flags.1?string
    const cond = t.match(/^(\w+)\.(\d+)\?(.+)$/)
    if (cond) {
        return {
            kind: 'flag',
            flagsField: cond[1]!,
            bit: Number(cond[2]),
            inner: parseType(cond[3]!),
        }
    }

    // Vector<T> (boxed) or vector<T> (bare)
    const vec = t.match(/^([Vv])ector<(.+)>$/)
    if (vec) {
        return { kind: 'vector', boxed: vec[1] === 'V', inner: parseType(vec[2]!) }
    }

    if (PRIMITIVES.has(t)) {
        switch (t) {
            case 'int':
                return { kind: 'int' }
            case 'long':
                return { kind: 'long' }
            case 'double':
                return { kind: 'double' }
            case 'string':
                return { kind: 'string' }
            case 'bytes':
                return { kind: 'bytes' }
            case 'int128':
                return { kind: 'int128' }
            case 'int256':
                return { kind: 'int256' }
            case 'Bool':
                return { kind: 'bool' }
            case 'true':
                return { kind: 'true' }
        }
    }

    if (t === 'Object' || t === 'X' || t.startsWith('!')) return { kind: 'object' }
    if (t.startsWith('%')) return { kind: 'bare', name: t.slice(1) }

    // Named type. Boxed iff the final segment is capitalized (e.g. dust.DustBalance,
    // Currency); otherwise a bare constructor reference (e.g. future_salt).
    const lastSeg = t.includes('.') ? t.slice(t.lastIndexOf('.') + 1) : t
    const first = lastSeg[0] ?? ''
    if (first >= 'A' && first <= 'Z') return { kind: 'boxed', name: t }
    return { kind: 'bare', name: t }
}
