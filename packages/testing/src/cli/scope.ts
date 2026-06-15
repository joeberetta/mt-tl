import { randomBytes } from 'node:crypto'

// Variable scope + `${...}` interpolation for scenarios. The scope is seeded with
// the scenario's `vars` plus `env` (process env), and grows as steps `capture`
// values (e.g. `capture: { 'bob.id': 'user.id' }` writes `bob.id`). Interpolation
// resolves `${dotted.path}` against it: a string that is EXACTLY `${path}` yields
// the raw value (number/object preserved); embedded refs splice in as text.
//
// Reserved dynamic tokens (generated fresh on each use): `${rand.long}` (random
// positive long, e.g. a sendMessage `random_id`), `${rand.int}`, `${now}` (unix
// seconds), `${now.ms}`, `${uuid}` (random hex — handy for unique handles/seeds).
//
// Consumers can add their OWN tokens via `generators` (e.g. `{ mnemonic: () =>
// generateMnemonic() }` → `${mnemonic}`). Resolution order: custom generators →
// built-ins → captured/var values.

const NOT_BUILTIN = Symbol('not-builtin')

/** A named generator: returns a fresh value each time `${name}` is interpolated. */
export type Generators = Record<string, () => unknown>

export class Scope {
    private readonly root: Record<string, unknown>
    private readonly generators: Generators

    constructor(seed: Record<string, unknown> = {}, generators: Generators = {}) {
        this.root = { ...seed }
        this.generators = generators
    }

    /** Read a dotted path (`a.b.0.c`); `undefined` if any segment is missing.
     *  Custom generators and reserved dynamic tokens resolve to a fresh value. */
    get(path: string): unknown {
        const gen = this.generators[path]
        if (gen) return gen()
        const dynamic = builtin(path)
        if (dynamic !== NOT_BUILTIN) return dynamic
        return getPath(this.root, path)
    }

    /** Write a dotted path, creating intermediate objects as needed. */
    set(path: string, value: unknown): void {
        const parts = path.split('.')
        let cur = this.root
        for (let i = 0; i < parts.length - 1; i++) {
            const k = parts[i]!
            if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}
            cur = cur[k] as Record<string, unknown>
        }
        cur[parts[parts.length - 1]!] = value
    }

    /** Deep-resolve `${...}` references in any value (recurses objects/arrays).
     *  Single-pass on purpose: a `${ref}` resolving to a string that itself
     *  contains `${...}` is left as-is, so a var reused on both sides of a
     *  capture/match (e.g. `"hi ${now}"`) stays IDENTICAL — re-resolving would
     *  re-evaluate generators like `${now}`/`${rand.long}` to different values. */
    interpolate(value: unknown): unknown {
        if (typeof value === 'string') return this.interpolateString(value)
        if (Array.isArray(value)) return value.map(v => this.interpolate(v))
        if (value && typeof value === 'object') {
            const out: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(value)) out[k] = this.interpolate(v)
            return out
        }
        return value
    }

    private interpolateString(s: string): unknown {
        const whole = /^\$\{([^}]+)\}$/.exec(s)
        if (whole) {
            const v = this.get(whole[1]!.trim())
            return v === undefined ? s : v // leave an unresolved ref verbatim
        }
        return s.replace(/\$\{([^}]+)\}/g, (m, path: string) => {
            const v = this.get(path.trim())
            return v === undefined ? m : String(v)
        })
    }
}

function builtin(path: string): unknown {
    switch (path) {
        case 'now':
            return Math.floor(Date.now() / 1000)
        case 'now.ms':
            return Date.now()
        case 'rand.long':
            return BigInt('0x' + randomBytes(8).toString('hex')) & 0x7fffffffffffffffn
        case 'rand.int':
            return randomBytes(4).readInt32LE(0)
        case 'uuid':
            return randomBytes(16).toString('hex')
        default:
            return NOT_BUILTIN
    }
}

function getPath(obj: unknown, path: string): unknown {
    let cur: unknown = obj
    for (const part of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined
        cur = (cur as Record<string, unknown>)[part]
    }
    return cur
}

/** Read a dotted path out of an arbitrary decoded value (for `expect`/`capture`). */
export function getByPath(obj: unknown, path: string): unknown {
    return getPath(obj, path)
}
