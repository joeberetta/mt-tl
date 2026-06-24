import type { ReactNode } from 'react'

/**
 * Lightweight syntax highlighter for a single reconstructed `.tl` definition line
 * (`name#id field:type … = ResultType;`). It tokenizes by whitespace — TL is a
 * whitespace-delimited grammar — then colors the structural pieces:
 *
 *   constructor/method name · namespace prefix · `#crc` id · field name ·
 *   `flags.N?` conditional (the `.N` bit is highlighted, the `flags` ref is not) ·
 *   boxed type · bare/builtin type · punctuation
 *
 * Returns React nodes so callers can drop it straight into a `<code>`/`<a>` body.
 */

// Bare (lowercase) TL types — everything else capitalized is a boxed type.
const BUILTIN = new Set([
    'int',
    'long',
    'double',
    'float',
    'string',
    'bytes',
    'int128',
    'int256',
    'int512',
    'bool',
    'true',
    'date',
    'object',
])

export interface TlToken {
    cls: string // '' = no class (whitespace / unknown)
    text: string
}

function typeClass(t: string): string {
    if (BUILTIN.has(t)) return 'tlk-builtin'
    // boxed-ness is the capitalization of the final segment (e.g. `messages.Dialogs`)
    const base = t.slice(t.lastIndexOf('.') + 1)
    return /^[A-Z]/.test(base) ? 'tlk-type' : 'tlk-builtin'
}

/** Highlight a type expression: `flags.N?` conditionals, `!`/`%` sigils and
 *  nested generics like `Vector<Message>`. */
function pushType(type: string, out: TlToken[]): void {
    let rest = type
    // `flags.N?` — keep the `flags` reference muted, accent only the `.N` bit
    const cond = rest.match(/^([A-Za-z_]\w*)\.(\d+)\?/)
    if (cond) {
        out.push({ cls: 'tlk-flagword', text: cond[1] })
        out.push({ cls: 'tlk-punct', text: '.' })
        out.push({ cls: 'tlk-flagbit', text: cond[2] })
        out.push({ cls: 'tlk-punct', text: '?' })
        rest = rest.slice(cond[0].length)
    }
    while (rest && (rest[0] === '!' || rest[0] === '%')) {
        out.push({ cls: 'tlk-punct', text: rest[0] })
        rest = rest.slice(1)
    }
    // the bitmask sigil `#` is structural — render it as punctuation, not a type
    if (rest === '#') {
        out.push({ cls: 'tlk-punct', text: '#' })
        return
    }
    const gen = rest.match(/^([A-Za-z_][\w.]*)<(.*)>$/)
    if (gen) {
        out.push({ cls: typeClass(gen[1]), text: gen[1] })
        out.push({ cls: 'tlk-punct', text: '<' })
        pushType(gen[2], out)
        out.push({ cls: 'tlk-punct', text: '>' })
        return
    }
    if (rest) out.push({ cls: typeClass(rest), text: rest })
}

export function tokenizeTlLine(line: string): TlToken[] {
    const out: TlToken[] = []
    let seenName = false
    let afterEq = false
    for (const w of line.split(/(\s+)/)) {
        if (w === '') continue
        if (/^\s+$/.test(w)) {
            out.push({ cls: '', text: w })
            continue
        }
        if (w === '=') {
            out.push({ cls: 'tlk-punct', text: '=' })
            afterEq = true
            continue
        }
        if (!seenName) {
            // first word: `name#id` (namespace prefix split off, id optional)
            const hash = w.indexOf('#')
            const name = hash >= 0 ? w.slice(0, hash) : w
            const dot = name.lastIndexOf('.')
            if (dot >= 0) {
                out.push({ cls: 'tlk-ns', text: name.slice(0, dot + 1) })
                out.push({ cls: 'tlk-name', text: name.slice(dot + 1) })
            } else {
                out.push({ cls: 'tlk-name', text: name })
            }
            if (hash >= 0) out.push({ cls: 'tlk-id', text: w.slice(hash) })
            seenName = true
            continue
        }
        if (afterEq) {
            // result type, with the trailing `;` peeled off
            let body = w
            const semi = body.endsWith(';')
            if (semi) body = body.slice(0, -1)
            pushType(body, out)
            if (semi) out.push({ cls: 'tlk-punct', text: ';' })
            continue
        }
        // a `field:type` pair
        const colon = w.indexOf(':')
        if (colon > 0) {
            out.push({ cls: 'tlk-field', text: w.slice(0, colon) })
            out.push({ cls: 'tlk-punct', text: ':' })
            pushType(w.slice(colon + 1), out)
        } else {
            out.push({ cls: 'tlk-punct', text: w })
        }
    }
    return out
}

export function highlightTlLine(line: string): ReactNode[] {
    return tokenizeTlLine(line).map((t, i) => (
        <span className={t.cls || undefined} key={i}>
            {t.text}
        </span>
    ))
}
