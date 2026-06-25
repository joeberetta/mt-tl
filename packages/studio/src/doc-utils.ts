import type { ApiSpec, SpecSymbol, SpecShape } from './spec-types.js'

/** Reconstruct the one-line `.tl` for a symbol at a given layer's shape:
 *  `name#id p1:type1 p2:type2 = ResultType;` (the canonical TL definition line). */
export function tlLine(sym: SpecSymbol, shape: SpecShape): string {
    const params = shape.params.map(p => `${p.name}:${p.type}`).join(' ')
    return `${sym.name}#${shape.id}${params ? ' ' + params : ''} = ${sym.type};`
}

export interface UsageRef {
    name: string
    kind: 'method' | 'constructor'
}

/** Methods that RETURN `typeName`, and symbols that take it as a param ("used by"),
 *  at `layer`. Both carry kind so links route correctly (B2 + B11 #3). */
export function typeUsage(spec: ApiSpec, typeName: string, layer: number): { returnedBy: UsageRef[]; usedBy: UsageRef[] } {
    const returnedBy: UsageRef[] = []
    const usedBy: UsageRef[] = []
    const all = [...Object.values(spec.methods), ...Object.values(spec.constructors)]
    for (const s of all) {
        const shape = s.byLayer[layer]
        if (!shape) continue
        if (s.kind === 'method' && (s.type === typeName || s.type === `Vector<${typeName}>`)) returnedBy.push({ name: s.name, kind: s.kind })
        if (shape.params.some(p => p.ref === typeName)) usedBy.push({ name: s.name, kind: s.kind })
    }
    const byName = (a: UsageRef, b: UsageRef): number => a.name.localeCompare(b.name)
    return { returnedBy: returnedBy.sort(byName), usedBy: usedBy.sort(byName) }
}

export interface ChangeEntry {
    name: string
    kind: 'method' | 'constructor'
    line: string // the new (or last-present) one-line .tl
    detail?: string // for "changed": what changed
}
export interface LayerDiff {
    layer: number
    prev?: number
    added: ChangeEntry[]
    changed: ChangeEntry[]
    removed: ChangeEntry[]
}

/** Auto-diff a layer against the previous one: added / changed (id or fields) / removed. */
export function computeLayerDiff(spec: ApiSpec, layer: number): LayerDiff {
    const idx = spec.layers.indexOf(layer)
    const prev = idx > 0 ? spec.layers[idx - 1] : undefined
    const added: ChangeEntry[] = []
    const changed: ChangeEntry[] = []
    const removed: ChangeEntry[] = []
    const all = [...Object.values(spec.methods), ...Object.values(spec.constructors)]
    for (const s of all) {
        const cur = s.byLayer[layer]
        const before = prev !== undefined ? s.byLayer[prev] : undefined
        if (cur && !before) {
            added.push({ name: s.name, kind: s.kind, line: tlLine(s, cur) })
        } else if (!cur && before) {
            // present at prev, gone now → removed at this layer
            removed.push({ name: s.name, kind: s.kind, line: tlLine(s, before) })
        } else if (cur && before) {
            const d = shapeDiff(before, cur)
            if (d) changed.push({ name: s.name, kind: s.kind, line: tlLine(s, cur), detail: d })
        }
    }
    const byName = (a: ChangeEntry, b: ChangeEntry): number => a.name.localeCompare(b.name)
    return { layer, prev, added: added.sort(byName), changed: changed.sort(byName), removed: removed.sort(byName) }
}

/** Diff two ARBITRARY layers (`from` → `to`, not necessarily adjacent): the net
 *  added / changed / removed across the whole span. Powers the changelog's
 *  "diff across layers" picker (e.g. 190 → 200 in one view). */
export function computeRangeDiff(spec: ApiSpec, from: number, to: number): LayerDiff {
    const added: ChangeEntry[] = []
    const changed: ChangeEntry[] = []
    const removed: ChangeEntry[] = []
    const all = [...Object.values(spec.methods), ...Object.values(spec.constructors)]
    for (const s of all) {
        const a = s.byLayer[from]
        const b = s.byLayer[to]
        if (b && !a) added.push({ name: s.name, kind: s.kind, line: tlLine(s, b) })
        else if (a && !b) removed.push({ name: s.name, kind: s.kind, line: tlLine(s, a) })
        else if (a && b) {
            const d = shapeDiff(a, b)
            if (d) changed.push({ name: s.name, kind: s.kind, line: tlLine(s, b), detail: d })
        }
    }
    const byName = (x: ChangeEntry, y: ChangeEntry): number => x.name.localeCompare(y.name)
    return { layer: to, prev: from, added: added.sort(byName), changed: changed.sort(byName), removed: removed.sort(byName) }
}

/** Field-level diff between two shapes of the same symbol (for the on-page layer diff, B11 #7). */
export function paramDiff(
    a: SpecShape,
    b: SpecShape,
): { idChanged?: [string, string]; added: string[]; removed: string[]; retyped: { name: string; from: string; to: string }[] } {
    const am = new Map(a.params.map(p => [p.name, p.type]))
    const bm = new Map(b.params.map(p => [p.name, p.type]))
    return {
        idChanged: a.id !== b.id ? [a.id, b.id] : undefined,
        added: b.params.filter(p => !am.has(p.name)).map(p => p.name),
        removed: a.params.filter(p => !bm.has(p.name)).map(p => p.name),
        retyped: b.params
            .filter(p => am.has(p.name) && am.get(p.name) !== p.type)
            .map(p => ({ name: p.name, from: am.get(p.name)!, to: p.type })),
    }
}

function shapeDiff(before: SpecShape, after: SpecShape): string | undefined {
    const parts: string[] = []
    if (before.id !== after.id) parts.push(`id ${before.id} → ${after.id}`)
    const bp = new Set(before.params.map(p => p.name))
    const ap = new Set(after.params.map(p => p.name))
    const addedF = after.params.filter(p => !bp.has(p.name)).map(p => `+${p.name}`)
    const removedF = before.params.filter(p => !ap.has(p.name)).map(p => `−${p.name}`)
    // a field whose type string changed (same name, different type)
    const bMap = new Map(before.params.map(p => [p.name, p.type]))
    const retypedF = after.params
        .filter(p => bMap.has(p.name) && bMap.get(p.name) !== p.type)
        .map(p => `~${p.name}`)
    parts.push(...addedF, ...removedF, ...retypedF)
    return parts.length ? parts.join(' ') : undefined
}
