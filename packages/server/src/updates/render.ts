import type { LayeredRegistry } from '../tl/layered-registry.js'
import type { TlObject } from '@mt-tl/tl'

/**
 * Renders a server update for a specific client layer.
 *
 * - Representable at the layer → unchanged.
 * - Not representable but pts-bearing → `updateUnsupported{pts, pts_count}`
 *   (preserves the pts accounting so the client resyncs via getDifference).
 * - Not representable and ephemeral (no pts) → dropped (returns null).
 *
 * Recurses into the common containers (`updateShort`, `updates`,
 * `updatesCombined`) so a single unrepresentable inner update doesn't sink the
 * whole batch.
 */
export function renderUpdateForLayer(
    update: TlObject,
    layer: number,
    layered: LayeredRegistry,
): TlObject | null {
    if (layered.representable(update, layer)) return update

    switch (update._) {
        case 'updateShort': {
            const inner = renderLeaf(update.update as TlObject, layer, layered)
            return inner ? { ...update, update: inner } : null
        }
        case 'updates':
        case 'updatesCombined': {
            const list = Array.isArray(update.updates) ? (update.updates as TlObject[]) : []
            const rendered = list
                .map(u => renderLeaf(u, layer, layered))
                .filter((u): u is TlObject => u !== null)
            return { ...update, updates: rendered }
        }
        default:
            return renderLeaf(update, layer, layered)
    }
}

function renderLeaf(update: TlObject, layer: number, layered: LayeredRegistry): TlObject | null {
    if (layered.representable(update, layer)) return update
    const pts = numberField(update, 'pts')
    if (pts !== undefined) {
        return { _: 'updateUnsupported', pts, pts_count: numberField(update, 'pts_count') ?? 0 }
    }
    return null // ephemeral, no pts — safe to drop
}

function numberField(obj: TlObject, key: string): number | undefined {
    const v = obj[key]
    return typeof v === 'number' ? v : undefined
}
