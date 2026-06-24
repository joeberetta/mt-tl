import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseType, type TlType, type TlDef } from './tl/ir.js'
import { parseSchemaDir } from './tl/parser.js'
import { DEFAULT_LAYER_PREFIX, matchLayerFile } from './tools/layer-naming.js'
import { PROTOCOL_WRAPPERS, protocolDefNames } from './tools/protocol.js'

/** Absolute path to the bundled MTProto protocol `.tl` schema (the default source). */
const protocolSchemaDir = fileURLToPath(new URL('../schema', import.meta.url))

/**
 * A machine-readable, **layer-aware** API spec built from the frozen per-layer
 * snapshots (`<prefix><N>.json`, prefix default `scheme_`) — the "OpenAPI for TL" that `@mt-tl/studio`
 * renders. Per symbol we keep its shape at every layer it appears in, so the UI
 * can pin the view to a layer, show per-field `since`/`removed` badges, and diff
 * the history. Descriptions (authored MD) are merged by the studio at render
 * time — this file is pure schema.
 *
 * Layer lifecycle is tracked on three levels — a symbol (method/constructor) can
 * be removed, a field can be removed (and its type can change), and a whole type
 * can disappear: each carries `since` + `until`/`removed`. A field's type change
 * is visible by diffing its shape across {@link SpecSymbol.byLayer}.
 *
 * Source of truth is the snapshots, not the in-progress `.tl` (which isn't a
 * shipped layer until you `mt-tl freeze` it). Snapshots are business-only.
 */

/** One parameter, enriched from its raw TL type + annotated with its layer span. */
export interface SpecParam {
    name: string
    /** Raw TL type text, e.g. `flags.5?true`, `Vector<Update>`, `InputPeer`. */
    type: string
    /** True for a `flags.N?…` conditional field. */
    optional: boolean
    /** The flag bit, when `optional`. */
    flagBit?: number
    /** A linkable type/constructor name this param refers to (for cross-links), if any. */
    ref?: string
    /** Earliest layer this param name appears on the symbol. */
    since: number
    /** Latest layer this param name appears on the symbol. */
    until: number
    /** True when the field is gone from the symbol's latest shape (removed before the symbol was). */
    removed: boolean
}

/** A symbol's concrete shape at one layer (its constructor id can differ per layer). */
export interface SpecShape {
    id: string
    layer: number
    params: SpecParam[]
}

/** A method or constructor, with its shape at every layer it exists on. */
export interface SpecSymbol {
    name: string
    kind: 'method' | 'constructor'
    /** Result/return type (for a method) or the abstract type a constructor belongs to. */
    type: string
    /** Earliest layer the symbol appears on. */
    sinceLayer: number
    /** Latest layer the symbol still exists on. */
    lastLayer: number
    /** True when the symbol is gone from the newest layer. */
    removed: boolean
    /** The first layer (after `lastLayer`) where the symbol is absent — present iff `removed`. */
    removedIn?: number
    /** Shape at {@link lastLayer}. */
    latest: SpecShape
    /** Shape keyed by layer — only layers where the symbol is present. */
    byLayer: Record<number, SpecShape>
}

/** An abstract type and the constructors that ever inhabit it. */
export interface SpecType {
    name: string
    /** Every constructor that ever belonged to the type (union); each carries its own removal. */
    constructors: string[]
    sinceLayer: number
    lastLayer: number
    removed: boolean
    removedIn?: number
}

export interface ApiSpec {
    /** Sorted ascending list of layers found in the snapshots. */
    layers: number[]
    latestLayer: number
    methods: Record<string, SpecSymbol>
    constructors: Record<string, SpecSymbol>
    types: Record<string, SpecType>
}

interface RawEntry {
    id: string
    predicate?: string
    method?: string
    params: { name: string; type: string }[]
    type: string
}
interface Snapshot {
    constructors: RawEntry[]
    methods: RawEntry[]
}

/** The linkable type name a param points at (for cross-links), unwrapping flags/vectors. */
function typeRef(t: TlType): string | undefined {
    switch (t.kind) {
        case 'boxed':
        case 'bare':
            return t.name
        case 'flag':
        case 'vector':
            return typeRef(t.inner)
        default:
            return undefined
    }
}

function entryToShape(e: RawEntry, layer: number): SpecShape {
    const params = e.params.map<SpecParam>(p => {
        const pt = parseType(p.type)
        return {
            name: p.name,
            type: p.type,
            optional: pt.kind === 'flag',
            ...(pt.kind === 'flag' ? { flagBit: pt.bit } : {}),
            ...(ref => (ref ? { ref } : {}))(typeRef(pt)),
            since: layer,
            until: layer,
            removed: false,
        }
    })
    return { id: e.id, layer, params }
}

/** First layer in `layers` strictly greater than `layer`, or undefined. */
function nextLayerAfter(layers: number[], layer: number): number | undefined {
    return layers.find(l => l > layer)
}

function snapshotFromDefs(defs: TlDef[]): Snapshot {
    const toEntry = (d: TlDef): RawEntry => ({
        id: d.id,
        ...(d.kind === 'method' ? { method: d.name } : { predicate: d.name }),
        params: d.params.map(p => ({ name: p.name, type: p.raw })),
        type: d.type,
    })
    // Snapshots are BUSINESS-only — drop the protocol/core ctors `parseSchemaDir`
    // injects (vector, rpc_result, …), mirroring {@link freezeLayer}. Otherwise
    // pointing the studio at raw `.tl` layers would leak protocol into the docs.
    const business = defs.filter(d => !d.isProtocol)
    return {
        constructors: business.filter(d => d.kind === 'constructor').map(toEntry),
        methods: business.filter(d => d.kind === 'method').map(toEntry),
    }
}

/**
 * Read per-layer snapshots from a directory, accepting EITHER frozen
 * `<prefix><N>.json` OR raw `<prefix><N>.tl` (parsed on the fly). The `.json` wins
 * when both exist for a layer. This lets a consumer point the studio straight at
 * their `.tl` layer files — no separate freeze step. `prefix` defaults to
 * `scheme_`; pass the SAME prefix you froze with.
 */
export function readLayerSnapshots(
    layersDir: string,
    prefix = DEFAULT_LAYER_PREFIX,
): { layer: number; snap: Snapshot }[] {
    const json = new Map<number, Snapshot>()
    const tl = new Map<number, string>()
    for (const f of readdirSync(layersDir)) {
        const jm = matchLayerFile(f, prefix, 'json')
        const tm = matchLayerFile(f, prefix, 'tl')
        if (jm !== null) json.set(jm, JSON.parse(readFileSync(join(layersDir, f), 'utf8')) as Snapshot)
        else if (tm !== null) tl.set(tm, f)
    }
    const out: { layer: number; snap: Snapshot }[] = []
    for (const [layer, snap] of json) out.push({ layer, snap })
    for (const [layer, f] of tl)
        if (!json.has(layer))
            out.push({ layer, snap: snapshotFromDefs(parseSchemaDir(join(layersDir, f)).defs) })
    return out.sort((a, b) => a.layer - b.layer)
}

/**
 * Read the per-layer snapshots and fold them into a layer-aware {@link ApiSpec}.
 *
 * The result is the consumer's BUSINESS API only: low-level MTProto types from
 * the protocol schema at `protocolDir` (handshake, service messages, `vector`,
 * `rpc_error`…) are excluded so they never leak into the rendered docs. The
 * public `invoke*`/`initConnection` wrappers ({@link PROTOCOL_WRAPPERS}) stay
 * visible. Pass a custom `protocolDir` (the same one you run the server with) so
 * an overridden protocol is hidden by its own definitions.
 */
export function buildApiSpec(
    layersDir: string,
    prefix = DEFAULT_LAYER_PREFIX,
    protocolDir = protocolSchemaDir,
): ApiSpec {
    const snaps = readLayerSnapshots(layersDir, prefix)
    const hidden = protocolDefNames(protocolDir)
    for (const w of PROTOCOL_WRAPPERS) hidden.delete(w)

    const layers = snaps.map(s => s.layer)
    const latestLayer = layers.at(-1) ?? 0
    const methods: Record<string, SpecSymbol> = {}
    const constructors: Record<string, SpecSymbol> = {}

    const ingest = (kind: 'method' | 'constructor', bag: Record<string, SpecSymbol>) => {
        for (const { layer, snap } of snaps) {
            for (const e of kind === 'method' ? snap.methods : snap.constructors) {
                const name = (e.predicate ?? e.method)!
                const shape = entryToShape(e, layer)
                const sym = bag[name]
                if (!sym) {
                    bag[name] = {
                        name,
                        kind,
                        type: e.type,
                        sinceLayer: layer,
                        lastLayer: layer,
                        removed: false,
                        latest: shape,
                        byLayer: { [layer]: shape },
                    }
                } else {
                    sym.byLayer[layer] = shape
                    sym.lastLayer = layer
                    sym.latest = shape
                    sym.type = e.type
                }
            }
        }
        for (const sym of Object.values(bag)) {
            // Symbol removal: present through lastLayer, then gone from the newest layer.
            sym.removed = sym.lastLayer < latestLayer
            if (sym.removed) sym.removedIn = nextLayerAfter(layers, sym.lastLayer)
            // Per-param span (`since`/`until`) across the layers the symbol is present.
            const present = Object.keys(sym.byLayer)
                .map(Number)
                .sort((a, b) => a - b)
            const first: Record<string, number> = {}
            const last: Record<string, number> = {}
            for (const L of present)
                for (const p of sym.byLayer[L]!.params) {
                    if (!(p.name in first)) first[p.name] = L
                    last[p.name] = L
                }
            for (const L of present)
                for (const p of sym.byLayer[L]!.params) {
                    p.since = first[p.name]!
                    p.until = last[p.name]!
                    // A field removed before the symbol itself: gone from the latest shape.
                    p.removed = last[p.name]! < sym.lastLayer
                }
        }
    }

    ingest('method', methods)
    ingest('constructor', constructors)

    // Drop low-level protocol symbols (everything from the protocol schema except
    // the public wrappers). Done BEFORE the type pass so protocol-only types
    // (RpcError, Pong, ResPQ…) fall out naturally with their constructors.
    for (const n of hidden) {
        delete methods[n]
        delete constructors[n]
    }

    // Type lifecycle: a type exists on a layer iff some constructor there returns it.
    const typeLayers: Record<string, Set<number>> = {}
    for (const { layer, snap } of snaps)
        for (const e of snap.constructors) (typeLayers[e.type] ??= new Set()).add(layer)

    const types: Record<string, SpecType> = {}
    for (const c of Object.values(constructors))
        (types[c.type] ??= emptyType(c.type)).constructors.push(c.name)
    for (const t of Object.values(types)) {
        const present = [...(typeLayers[t.name] ?? [])].sort((a, b) => a - b)
        t.sinceLayer = present[0] ?? 0
        t.lastLayer = present.at(-1) ?? 0
        t.removed = t.lastLayer < latestLayer
        if (t.removed) t.removedIn = nextLayerAfter(layers, t.lastLayer)
        t.constructors.sort()
    }

    return { layers, latestLayer, methods, constructors, types }
}

function emptyType(name: string): SpecType {
    return { name, constructors: [], sinceLayer: 0, lastLayer: 0, removed: false }
}

function entryToDef(e: RawEntry, kind: 'constructor' | 'method'): TlDef {
    return {
        id: e.id,
        idNum: parseInt(e.id, 16) >>> 0,
        name: (e.predicate ?? e.method)!,
        kind,
        params: e.params.map(p => ({ name: p.name, raw: p.type, type: parseType(p.type) })),
        type: e.type,
        isProtocol: false,
    }
}

/**
 * The flat, fully-structured registry a browser MTProto client needs to encode
 * requests and decode replies: the fixed MTProto **protocol** schema merged with
 * every business def across all frozen layers (latest layer first, deduped by
 * wire id — so decode-by-id covers historical ids and encode-by-name resolves to
 * the latest constructor). Unlike {@link buildApiSpec} (docs-shaped, per-layer),
 * this emits ready-to-use {@link TlDef}s with parsed param types, so the consumer
 * of the JSON needs no TL parser. `@mt-tl/studio` ships it as `wire.json`.
 */
export function buildWireDefs(
    layersDir: string,
    prefix = DEFAULT_LAYER_PREFIX,
    protocolDir = protocolSchemaDir,
): TlDef[] {
    const snaps = readLayerSnapshots(layersDir, prefix).sort((a, b) => b.layer - a.layer) // latest first → wins name/id clashes

    const defs: TlDef[] = []
    const seen = new Set<string>()
    const push = (d: TlDef): void => {
        if (seen.has(d.id)) return
        seen.add(d.id)
        defs.push(d)
    }

    for (const d of parseSchemaDir(protocolDir).defs) push(d)
    for (const { snap } of snaps) {
        for (const e of snap.constructors) push(entryToDef(e, 'constructor'))
        for (const e of snap.methods) push(entryToDef(e, 'method'))
    }
    return defs
}
