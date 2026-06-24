import { parseSchemaDir } from '../tl/parser.js'

/**
 * MTProto wrapper methods the engine unwraps (`invoke*` / `initConnection`).
 * They live in the protocol schema but ARE part of the public API surface, so
 * the studio docs keep them VISIBLE even when the rest of the protocol plumbing
 * (handshake, service messages, `vector`, `rpc_error`…) is hidden. Mirrors the
 * server dispatcher's wrapper set.
 */
export const PROTOCOL_WRAPPERS = new Set<string>([
    'invokeWithLayer',
    'initConnection',
    'invokeWithoutUpdates',
    'invokeAfterMsg',
    'invokeAfterMsgs',
    'invokeWithMessagesRange',
    'invokeWithTakeout',
])

/**
 * Every constructor/method NAME declared by the protocol schema at `protocolDir`
 * (the bundled MTProto protocol, or a consumer-overridden one). The studio docs
 * subtract these (minus {@link PROTOCOL_WRAPPERS}) so low-level MTProto types
 * never leak into the consumer's API reference.
 */
export function protocolDefNames(protocolDir: string): Set<string> {
    return new Set(parseSchemaDir(protocolDir).defs.map(d => d.name))
}
