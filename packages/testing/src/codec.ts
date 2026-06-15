import { protocolSchemaDir } from '@mt-tl/tl'
import { loadSchema, TlCodec } from '@mt-tl/server/testkit'

/**
 * Builds a {@link TlCodec} for a test client over the consumer's schema. The
 * fixed MTProto **protocol** schema is merged in automatically, exactly like the
 * gateway does — so the client speaks both the handshake/service types and the
 * app's business types. Decode is by wire id (layer-agnostic); encode is by name
 * (first registration wins), matching the gateway.
 *
 * @param schemaDirs - the app's business `.tl` directory (or several).
 *
 * @example
 * ```ts
 * const codec = createCodec(schemaDir)
 * const session = await TestSession.open(url, publicKey, codec)
 * ```
 */
export function createCodec(schemaDirs: string | string[]): TlCodec {
    const dirs = Array.isArray(schemaDirs) ? schemaDirs : [schemaDirs]
    const { registry } = loadSchema([protocolSchemaDir, ...dirs])
    return new TlCodec(registry)
}
