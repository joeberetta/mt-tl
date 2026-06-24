/**
 * Naming of frozen per-layer snapshot files. The default `scheme_<N>.{json,tl}`
 * matches Telegram's historical layout, but a consumer can pick any prefix
 * (e.g. `layer_<N>.json`) and thread it through both the writer ({@link freezeLayer})
 * and the readers (the gateway's `loadLayeredRegistry`, the studio's `buildApiSpec`).
 * Keeping the prefix logic here means writer and readers can never drift apart.
 */

/** Default filename prefix for frozen snapshots: `scheme_<N>.{json,tl}`. */
export const DEFAULT_LAYER_PREFIX = 'scheme_'

/** Escape a string for literal use inside a RegExp (the prefix is consumer-supplied). */
function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Filename of a frozen snapshot for `layer`: `<prefix><layer>.<ext>`. */
export function layerSnapshotName(layer: number, ext: 'json' | 'tl', prefix = DEFAULT_LAYER_PREFIX): string {
    return `${prefix}${layer}.${ext}`
}

/**
 * If `file` is a frozen snapshot for the given `prefix`/`ext`, return its layer
 * number; otherwise `null`. Pass `ext` to require a specific extension, or omit
 * to accept both `json` and `tl`.
 */
export function matchLayerFile(
    file: string,
    prefix = DEFAULT_LAYER_PREFIX,
    ext?: 'json' | 'tl',
): number | null {
    const m = new RegExp(`^${escapeRe(prefix)}(\\d+)\\.(?:${ext ?? 'json|tl'})$`).exec(file)
    return m ? Number(m[1]) : null
}
