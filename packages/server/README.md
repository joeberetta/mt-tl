# @mt-tl/server

Build an MTProto 2.0 server the way you'd build a [Fastify](https://fastify.dev/)
app: `createServer`, register routes, `listen`. The framework owns the entire
protocol — WebSocket + raw-TCP transport, framing, auth-key exchange, sessions,
server salts, service messages, AES-IGE crypto, TL (de)serialization, layered
encoding, server-push. You write **methods**.

```bash
npm install @mt-tl/server
npm install -D @mt-tl/tl   # type generator + codec, used by `gen:types`
```

```ts
import { createServer } from '@mt-tl/server'
import type { RpcMethods } from './generated/schema.js' // generated from your .tl

const app = createServer<RpcMethods>(config)

app.method('help.getConfig', { auth: false }, async () => ({ _: 'config' /* … */ }))

await app.listen() // opens the WebSocket + raw-TCP carriers
```

You bring three things: a **config** (`MTProtoConfig`), a **`.tl` schema** (your
methods), and **handlers**.

## What you get

- `createServer` / `definePlugin` — routes and Fastify-style plugins (explicit DI).
- Hooks (`defineHook`, pre-handlers), `ctx.login/logout/revoke`, `ctx.set/get`.
- Server-push: `ctx.push(subject, update)`, `ctx.pushToAuthKey(...)`,
  `createUpdatePublisher` (cross-process).
- Errors that map to `rpc_error`: `BadRequestError`, `AuthRequiredError`,
  `NotFoundError`, `FloodWaitError`, `InternalError`.
- Schema-version migrations (per-layer ladders, applied on input/output).

In-process by design: the engine and your handlers run in one process; scale by
running more replicas behind a load balancer (shared state in Mongo + Redis).

## Docs

Full guide (getting started, core concepts, sessions & auth, server-push,
releasing a version, deployment) and a complete copy-me example app live in the
project repository under `docs/` and `examples/demo-eos-seed-app`.

## License

MIT
