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

// @mt-tl/tl ships only the fixed MTProto **protocol** schema; business `.tl`
// lives in the consumer app. This is the protocol-only default; apps pass their
// own schema dir to the gateway.
/** Absolute path to the bundled MTProto protocol `.tl` schema directory. */
export const protocolSchemaDir = fileURLToPath(new URL('../schema', import.meta.url))
