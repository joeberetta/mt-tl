import type { TlObject, TlValue } from './tl/value.js'

/**
 * One rung of a predicate's migration ladder. `up` maps THIS version's shape to
 * the NEXT version's; `down` maps the next version back to this one. The newest
 * (canonical) rung has neither.
 */
export interface MigrationRung {
    /** Layer this shape was introduced. */
    since: number
    up?: (obj: Record<string, unknown>) => Record<string, unknown>
    down?: (obj: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Per-predicate migration ladders. The gateway normalizes inbound values to the
 * canonical (newest) shape (`up`) before forwarding, and renders canonical values
 * down to a client's layer (`down`) before encoding — so workers only ever see
 * the canonical shape. Scales to N versions: one rung per version; adding a
 * version appends a rung and never touches the others.
 *
 * Only non-additively-changed predicates need a ladder; everything else is
 * handled by decode-union + layered-encode with no rungs (identity here).
 */
export class MigrationRegistry {
    private byPredicate = new Map<string, MigrationRung[]>()

    /** Register a predicate's ladder (rungs in any order; sorted by `since`). */
    register(predicate: string, rungs: MigrationRung[]): this {
        this.byPredicate.set(
            predicate,
            [...rungs].sort((a, b) => a.since - b.since),
        )
        return this
    }

    has(predicate: string): boolean {
        return this.byPredicate.has(predicate)
    }

    get size(): number {
        return this.byPredicate.size
    }

    /** Normalize a value decoded at `fromLayer` up to the canonical shape. */
    up(value: TlValue, fromLayer: number): TlValue {
        return this.recurse(value, obj => this.upObject(obj, fromLayer))
    }

    /** Render a canonical value down to `toLayer`'s shape. */
    down(value: TlValue, toLayer: number): TlValue {
        return this.recurse(value, obj => this.downObject(obj, toLayer))
    }

    // Children-first walk: normalize nested objects, then transform the parent.
    private recurse(value: TlValue, fn: (obj: TlObject) => TlObject): TlValue {
        if (Array.isArray(value)) return value.map(v => this.recurse(v, fn))
        if (value && typeof value === 'object' && !Buffer.isBuffer(value) && '_' in value) {
            const obj = value as TlObject
            const next: TlObject = { _: obj._ }
            for (const [k, v] of Object.entries(obj)) {
                if (k !== '_') next[k] = this.recurse(v as TlValue, fn)
            }
            return fn(next)
        }
        return value
    }

    private upObject(obj: TlObject, fromLayer: number): TlObject {
        const rungs = this.byPredicate.get(obj._)
        if (!rungs) return obj
        let cur: Record<string, unknown> = obj
        for (let i = startRung(rungs, fromLayer); i <= rungs.length - 2; i++) {
            const up = rungs[i]!.up
            if (up) cur = up(cur)
        }
        return cur as TlObject
    }

    private downObject(obj: TlObject, toLayer: number): TlObject {
        const rungs = this.byPredicate.get(obj._)
        if (!rungs) return obj
        const target = startRung(rungs, toLayer)
        let cur: Record<string, unknown> = obj
        for (let i = rungs.length - 2; i >= target; i--) {
            const down = rungs[i]!.down
            if (down) cur = down(cur)
        }
        return cur as TlObject
    }
}

/** Index of the rung active at `layer` (the latest with since <= layer; else 0). */
function startRung(rungs: MigrationRung[], layer: number): number {
    let idx = 0
    for (let i = 0; i < rungs.length; i++) {
        if (rungs[i]!.since <= layer) idx = i
        else break
    }
    return idx
}
