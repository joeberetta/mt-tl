// Resolve a symbol's per-layer shape from the run-length `shapes` array (api.json
// format v2). The single accessor the UI uses instead of the old `byLayer` map —
// see studio-output-optimization-plan.md / packages/tl/src/spec.ts (foldShapes).
import type { SpecSymbol, SpecShape } from './spec-types.js'

/**
 * The symbol's shape at layer `L`, or `undefined` if it doesn't exist there.
 * `L` is always one of `spec.layers` (how every caller invokes it). Run boundaries
 * already encode presence gaps, so a plain range check is exact: a hole in the
 * symbol's presence falls between two runs and resolves to `undefined`.
 */
export function shapeAt(sym: SpecSymbol, layer: number): SpecShape | undefined {
    const run = sym.shapes.find(r => layer >= r.from && layer <= r.to)
    return run ? { id: run.id, layer, params: run.params } : undefined
}

/**
 * The symbol's shape at its latest layer — the last run materialized. A symbol
 * always exists on ≥1 layer, so this is never undefined (replaces the old
 * `sym.latest`, which we dropped to shrink api.json).
 */
export function latestShape(sym: SpecSymbol): SpecShape {
    const run = sym.shapes[sym.shapes.length - 1]!
    return { id: run.id, layer: run.to, params: run.params }
}
