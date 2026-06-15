// @mt-tl/testing — e2e test tooling for servers built on @mt-tl/server +
// @mt-tl/tl. Boot the app in-process (`createTestServer`), drive it with a
// real, handshaken MTProto client (`TestSession` — auto-unwrapping `invoke`,
// `expectUpdate` for server-push), and coordinate several users at once
// (`createHarness`). Framework-agnostic: works under vitest, jest, or none.

export { createTestServer, type TestServer, type TestServerOptions } from './server.js'
export { createHarness, type TestHarness } from './harness.js'
export {
    TestSession,
    RpcError,
    type UpdateMatch,
    type InvokeOpts,
    type ExpectUpdateOpts,
    type ConnectOpts,
    type InvokeTrace,
} from './session.js'
export { createCodec } from './codec.js'

// Low-level escape hatch: the raw protocol client + transports, for tests that
// need hand-built containers, custom salts/msg_ids, or a TCP carrier.
export { TestClient, genMsgId, type SendOpts } from './client/test-client.js'
export { wsTransport, tcpTransport, type ClientTransport } from './client/transport.js'
