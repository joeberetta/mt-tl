import { fileURLToPath } from 'node:url'

export * from './tl/ir.js'
export * from './tl/value.js'
export * from './tl/parser.js'
export * from './tl/crc32.js'
export * from './rpc.js'
export * from './wire.js'
export * from './migrate.js'
// Shared structured logger — the server engine, the handler layer, and your app
// import it for one consistent log style (see docs/guide/observability.md).
export * from './logger.js'
// Codegen + layer tooling — consumers generate TS types and freeze layer
// snapshots from THEIR `.tl` schema.
export { generateSchemaTs, writeSchemaTs } from './codegen/gen-types.js'
export { freezeLayer, type FreezeResult } from './tools/freeze-layer.js'
// Frozen-snapshot filename helpers (default prefix `scheme_`). Shared by the
// writer (freezeLayer) and the readers (gateway, studio) so a custom prefix
// stays consistent across packages.
export { DEFAULT_LAYER_PREFIX, layerSnapshotName, matchLayerFile } from './tools/layer-naming.js'
// Protocol schema helpers: the public wrapper set + the protocol name set the
// studio docs subtract. Shared so server/studio agree on what "protocol" is.
export { PROTOCOL_WRAPPERS, protocolDefNames } from './tools/protocol.js'
// Layer-aware API spec (api.json) — the input @mt-tl/studio renders into an
// interactive doc + playground. Built from the frozen per-layer snapshots.
export {
    buildApiSpec,
    buildWireDefs,
    type ApiSpec,
    type SpecSymbol,
    type SpecShape,
    type SpecParam,
    type SpecType,
} from './spec.js'

// @mt-tl/tl ships only the fixed MTProto **protocol** schema; business `.tl`
// lives in the consumer app. This is the protocol-only default; apps pass their
// own schema dir to the gateway.
/** Absolute path to the bundled MTProto protocol `.tl` schema directory. */
export const protocolSchemaDir = fileURLToPath(new URL('../schema', import.meta.url))
