import CRC32 from 'crc-32'

/**
 * Computes a TL constructor id (crc32 of the normalized definition line),
 * mirroring the existing backend's `get-tl-object-crc32.js` exactly so our
 * validation agrees with the schema's declared ids.
 *
 * Normalization (applied repeatedly until stable):
 *   :bytes              -> :string
 *   ?bytes              -> ?string
 *   #<hex>              -> (constructor id removed)
 *   name:flags.N?true   -> (removed; presence-only flags don't affect the id)
 *   < > and {} and ;    -> stripped / spaced
 *   collapse double / edge spaces
 */
function normalizeSchemaLine(line: string): string {
    const rules: Array<[RegExp, string]> = [
        [/:bytes /g, ':string '],
        [/\?bytes /g, '?string '],
        [/#[a-f0-9]+ /g, ' '],
        [/ [a-zA-Z0-9_]+:flags\.[0-9]+\?true/g, ''],
        [/</g, ' '],
        [/>/g, ' '],
        [/;/g, ''],
        [/\{/g, ''],
        [/\}/g, ''],
    ]

    let out = line
    let prev: string
    do {
        prev = out
        for (const [re, to] of rules) out = out.replace(re, to)
        out = out.replace(/ {2}/g, ' ').replace(/^ /, '').replace(/ $/, '')
    } while (out !== prev)

    return out
}

export function getTlObjectCrc32(line: string): string {
    const hashNum = CRC32.bstr(normalizeSchemaLine(line))
    const unsigned = hashNum < 0 ? hashNum + 0x100000000 : hashNum
    return unsigned.toString(16).padStart(8, '0')
}
