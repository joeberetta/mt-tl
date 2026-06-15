import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TlDef } from '@mt-tl/tl'
import { parseType } from '@mt-tl/tl'
import type { TlValue } from '@mt-tl/tl'

interface RawDef {
    id: string
    predicate?: string
    method?: string
    params: Array<{ name: string; type: string }>
    type: string
}
interface RawSchema {
    constructors: RawDef[]
    methods: RawDef[]
}

interface LayerSchema {
    byName: Map<string, TlDef>
}

/**
 * Per-layer schema snapshots, used to encode a result/update with the
 * constructor id and fields valid for a client's negotiated layer (decoding
 * stays global by id). Also answers whether a value is representable at a layer
 * — a pushed update whose type doesn't exist there must be substituted/dropped.
 */
export class LayeredRegistry {
    private layers = new Map<number, LayerSchema>()
    private sortedLayers: number[] = []

    addLayer(layer: number, defs: TlDef[]): void {
        const byName = new Map<string, TlDef>()
        for (const def of defs) if (!byName.has(def.name)) byName.set(def.name, def)
        this.layers.set(layer, { byName })
        this.sortedLayers = [...this.layers.keys()].sort((a, b) => a - b)
    }

    hasLayers(): boolean {
        return this.sortedLayers.length > 0
    }

    /** Every distinct def across all layers (by id) — for the decode-union registry. */
    allDefs(): TlDef[] {
        const seen = new Set<string>()
        const out: TlDef[] = []
        for (const { byName } of this.layers.values()) {
            for (const def of byName.values()) {
                if (seen.has(def.id)) continue
                seen.add(def.id)
                out.push(def)
            }
        }
        return out
    }

    layerNumbers(): number[] {
        return [...this.sortedLayers]
    }

    /** Largest available layer <= requested (or the smallest if requested is below all). */
    resolveLayer(requested: number): number | undefined {
        if (!this.sortedLayers.length) return undefined
        let best: number | undefined
        for (const layer of this.sortedLayers) {
            if (layer <= requested) best = layer
            else break
        }
        return best ?? this.sortedLayers[0]
    }

    resolve(name: string, layer: number): TlDef | undefined {
        const l = this.resolveLayer(layer)
        if (l === undefined) return undefined
        return this.layers.get(l)?.byName.get(name)
    }

    /** True iff every constructed type in the value tree exists at `layer`. */
    representable(value: TlValue, layer: number): boolean {
        if (value === null || value === undefined) return true
        if (Array.isArray(value)) return value.every(v => this.representable(v, layer))
        if (Buffer.isBuffer(value)) return true
        if (typeof value === 'object') {
            const obj = value as Record<string, unknown>
            if (typeof obj._ === 'string') {
                if (!this.resolve(obj._, layer)) return false
                for (const [k, v] of Object.entries(obj)) {
                    if (k !== '_' && !this.representable(v as TlValue, layer)) return false
                }
            }
            return true
        }
        return true // primitives, bigint, boolean, string, number
    }
}

function rawToDef(raw: RawDef, kind: 'constructor' | 'method'): TlDef {
    const id = raw.id.toLowerCase().padStart(8, '0')
    return {
        id,
        idNum: parseInt(id, 16) >>> 0,
        name: (raw.predicate ?? raw.method)!,
        kind,
        params: raw.params.map(p => ({ name: p.name, raw: p.type, type: parseType(p.type) })),
        type: raw.type,
        isProtocol: false,
    }
}

/**
 * Loads `scheme_<layer>.json` snapshots from a directory into a
 * {@link LayeredRegistry}. A missing directory yields an empty registry
 * (layered encoding then disabled — the gateway falls back to single-schema).
 */
export function loadLayeredRegistry(dir: string): LayeredRegistry {
    const registry = new LayeredRegistry()
    if (!existsSync(dir)) return registry

    for (const file of readdirSync(dir)) {
        const m = file.match(/_(\d+)\.json$/)
        if (!m) continue
        const layer = Number(m[1])
        const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8')) as RawSchema
        const defs = [
            ...raw.constructors.map(c => rawToDef(c, 'constructor')),
            ...(raw.methods ?? []).map(c => rawToDef(c, 'method')),
        ]
        registry.addLayer(layer, defs)
    }
    return registry
}
