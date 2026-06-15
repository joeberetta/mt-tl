// @mt-tl/server/testkit — protocol primitives a TEST CLIENT needs (TL codec +
// the client side of the MTProto 2.0 crypto). NOT part of the consumer surface:
// servers are built with `createServer` from the package root. This subpath
// exists so `@mt-tl/testing` can drive a real handshake + encrypted RPC
// against a gateway without deep-importing internal files. The crypto here is
// the same code pinned byte-for-byte by `test/crypto.kat.test.ts`.

export { TlReader } from './tl/reader.js'
export { TlWriter } from './tl/writer.js'
export { TlCodec } from './tl/codec.js'
export { loadSchema, type LoadSchemaResult } from './tl/registry.js'

export { igeEncrypt, igeDecrypt } from './crypto/aes-ige.js'
export { sha1 } from './crypto/hashes.js'
export { generateMessageKey, computeMsgKey } from './crypto/msg-key.js'
export { modPow } from './crypto/dh.js'
export { rsaEncryptNoPadding } from './crypto/rsa.js'

export { toBigIntBE, toBigIntLE, toBufferBE, toBufferLE, xorBuffers } from './util/bytes.js'
