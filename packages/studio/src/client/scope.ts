// Browser port of @mt-tl/testing's scenario Scope: `${...}` interpolation with
// dynamic tokens + values captured from earlier steps. Keep in sync with
// packages/testing/src/cli/scope.ts (this uses getRandomValues, not node crypto).
//
// Dynamic tokens (fresh each use): ${rand.long} (random positive long, e.g. a
// sendMessage random_id), ${rand.int}, ${now} (unix s), ${now.ms}, ${uuid}.
// Captured/var paths: ${alice.id}, ${sent.phone_code_hash}, … (dotted).

const NOT_BUILTIN = Symbol('not-builtin')

export class Scope {
    private readonly root: Record<string, unknown>

    constructor(seed: Record<string, unknown> = {}) {
        this.root = { ...seed }
    }

    get(path: string): unknown {
        const dynamic = builtin(path)
        if (dynamic !== NOT_BUILTIN) return dynamic
        return getByPath(this.root, path)
    }

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

    /** Deep-resolve `${...}` in any value (recurses objects/arrays; leaves binary alone). */
    interpolate(value: unknown): unknown {
        if (typeof value === 'string') return this.interpolateString(value)
        if (value instanceof Uint8Array) return value
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
            return v === undefined ? s : v // a sole `${path}` yields the RAW value (bigint/object kept)
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
        case 'rand.long': {
            const b = new Uint8Array(8)
            crypto.getRandomValues(b)
            let v = 0n
            for (const x of b) v = (v << 8n) | BigInt(x)
            return v & 0x7fffffffffffffffn
        }
        case 'rand.int': {
            const b = new Uint8Array(4)
            crypto.getRandomValues(b)
            return new DataView(b.buffer).getInt32(0, true)
        }
        case 'uuid': {
            const b = new Uint8Array(16)
            crypto.getRandomValues(b)
            return Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
        }
        default:
            return NOT_BUILTIN
    }
}

export function getByPath(obj: unknown, path: string): unknown {
    let cur: unknown = obj
    for (const part of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined
        cur = (cur as Record<string, unknown>)[part]
    }
    return cur
}
