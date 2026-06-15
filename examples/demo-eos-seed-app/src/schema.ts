import { fileURLToPath } from 'node:url'

// This app owns its full `.tl` schema (the MTProto protocol layer + its own
// business methods). The gateway is handed these paths at bootstrap — the
// framework ships only the protocol schema as a default.

/** Absolute path to this app's `.tl` schema directory (protocol + business). */
export const schemaDir = fileURLToPath(new URL('../schema', import.meta.url))
/** Absolute path to this app's per-layer snapshot directory (`scheme_N.json`). */
export const layersDir = fileURLToPath(new URL('../schema/layers', import.meta.url))
