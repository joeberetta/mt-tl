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
export interface SpecSymbol {
    name: string
    kind: 'method' | 'constructor'
    type: string
    sinceLayer: number
    lastLayer: number
    removed: boolean
    removedIn?: number
    latest: SpecShape
    byLayer: Record<number, SpecShape>
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
    layers: number[]
    latestLayer: number
    methods: Record<string, SpecSymbol>
    constructors: Record<string, SpecSymbol>
    types: Record<string, SpecType>
}

/** A prose scenario guide, authored as Markdown (scenarios/<slug>.md), rendered by the studio. */
export interface Scenario {
    slug: string
    title: string
    body: string
}
