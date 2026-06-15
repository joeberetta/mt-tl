/**
 * In-code representation of a decoded TL value.
 *
 * A constructed type is a tagged plain object `{ _: 'predicate.name', ...fields }`
 * (matching the existing `toPrimitiveObject` convention). Wire primitives map to:
 *   int -> number, long/flags -> bigint|number, double -> number, string -> string,
 *   bytes/int128/int256 -> Buffer, Bool/true -> boolean, vector -> array.
 */
export type TlValue = number | bigint | boolean | string | Buffer | TlObject | TlValue[] | null | undefined

export interface TlObject {
    _: string
    [field: string]: TlValue
}

/** JSON-safe encoding so values can cross the JSON-RPC boundary. */
export type JsonValue =
    | number
    | boolean
    | string
    | null
    | { $bigint: string }
    | { $bin: string }
    | JsonValue[]
    | { [k: string]: JsonValue }

function isBuffer(v: unknown): v is Buffer {
    return Buffer.isBuffer(v)
}

export function toJson(value: TlValue): JsonValue {
    if (value === null || value === undefined) return null
    if (typeof value === 'bigint') return { $bigint: value.toString() }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value
    if (isBuffer(value)) return { $bin: value.toString('base64') }
    if (Array.isArray(value)) return value.map(toJson)
    // TlObject
    const out: { [k: string]: JsonValue } = {}
    for (const [k, v] of Object.entries(value)) out[k] = toJson(v as TlValue)
    return out
}

export function fromJson(value: JsonValue): TlValue {
    if (value === null) return null
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value
    if (Array.isArray(value)) return value.map(fromJson)
    if (typeof value === 'object') {
        if ('$bigint' in value && typeof value.$bigint === 'string') return BigInt(value.$bigint)
        if ('$bin' in value && typeof value.$bin === 'string') return Buffer.from(value.$bin, 'base64')
        const out: { [k: string]: TlValue } = {}
        for (const [k, v] of Object.entries(value)) out[k] = fromJson(v as JsonValue)
        return out as TlObject
    }
    return null
}

/** Pretty JSON string for terminal logging (bigint/Buffer made readable). */
export function stringify(value: TlValue, indent = 2): string {
    return JSON.stringify(toJson(value), null, indent)
}
