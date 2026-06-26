// Mirror of @mt-tl/tl's ApiSpec — the studio consumes the generated api.json as
// plain data, so it keeps its own copy of the shape (no runtime dep on the node
// engine that produced it). Keep in sync with packages/tl/src/spec.ts.

export interface SpecParam {
    name: string
    type: string
    optional: boolean
    flagBit?: number
    ref?: string
    since: number
    until: number
    removed: boolean
}
export interface SpecShape {
    id: string
    layer: number
    params: SpecParam[]
}
/** A distinct shape valid across a contiguous run of layers [from,to] (run-length-encoded). */
export interface SpecShapeRun {
    id: string
    params: SpecParam[]
    from: number
    to: number
}
export interface SpecSymbol {
    name: string
    kind: 'method' | 'constructor'
    type: string
    sinceLayer: number
    lastLayer: number
    removed: boolean
    removedIn?: number
    /** Distinct shapes, run-length-encoded over the layers present, sorted by `from`.
     *  Resolve "shape at layer L" with `shapeAt`, the latest shape with `latestShape` (./spec-access). */
    shapes: SpecShapeRun[]
}
export interface SpecType {
    name: string
    constructors: string[]
    sinceLayer: number
    lastLayer: number
    removed: boolean
    removedIn?: number
}
export interface ApiSpec {
    /** Output format version (2 = run-length `shapes`). */
    version: number
    layers: number[]
    latestLayer: number
    methods: Record<string, SpecSymbol>
    constructors: Record<string, SpecSymbol>
    types: Record<string, SpecType>
}

/**
 * A scenario guide's metadata (from `scenarios/index.json`). The Markdown body is
 * fetched lazily per slug (`scenarios/<slug>.md`) when the guide is opened — see
 * doc-fetch.ts. `interactive` (computed at build time) drives the "play" badge in
 * the nav/home without loading the body.
 */
export interface Scenario {
    slug: string
    title: string
    interactive: boolean
}
