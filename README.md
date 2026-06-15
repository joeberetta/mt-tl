# mt-tl — an MTProto 2.0 server framework

Build an MTProto 2.0 server the way you'd build a [Fastify](https://fastify.dev/)
app: `createServer`, register routes, `listen`. The framework owns the entire
protocol — WebSocket + raw-TCP transport, framing, auth-key exchange, sessions,
server salts, service messages, AES-IGE crypto, TL (de)serialization, layered
encode, server-push. You write **methods**.

```ts
const app = createServer<RpcMethods>(config)
app.method('account.getAccountTTL', async (params, ctx) => ({ _: 'accountDaysTTL', days: 365 }))
await app.listen()
```

You bring a **config**, a **`.tl` schema** (your methods), and **handlers** — see
the **[5-minute start](docs/guide/getting-started.md)**.

## This repo

A Yarn-workspaces monorepo. You build against `@mt-tl/server` (+ `@mt-tl/tl`
for codegen) — the protocol engine + handler layer are folded inside
`@mt-tl/server`; `@mt-tl/testing` is an optional dev-only e2e toolkit.

| Workspace                                                  | What it is                                                                                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/server`](packages/server)                       | **`@mt-tl/server`** — what you install: `createServer`, routes, plugins, hooks, `ctx.push`, `createUpdatePublisher` — and the whole protocol engine + handler layer folded in. |
| [`packages/tl`](packages/tl)                               | **`@mt-tl/tl`** — TL tooling: the type generator (`gen:types`), generic wire codec, migrations, and the bundled MTProto **protocol** schema.                                   |
| [`packages/testing`](packages/testing)                     | **`@mt-tl/testing`** — e2e test tooling: an in-process server harness, a real handshaking client, multi-user sessions, and a YAML scenario runner (`mtproto-test`).            |
| [`examples/demo-eos-seed-app`](examples/demo-eos-seed-app) | A complete consumer app (EOS-seed auth + main-screen methods). Owns its schema, config, deploy files. **Copy it.**                                                               |

## Where to go

- **Building an app on the framework?** → **[docs/guide/](docs/guide/)**, starting
  with the **[5-minute start](docs/guide/getting-started.md)**, then
  **[core concepts](docs/guide/core-concepts.md)**. The runnable example is
  [`examples/demo-eos-seed-app`](examples/demo-eos-seed-app/) — its README is the
  self-contained "run / develop / deploy this app".
- **Maintaining the framework itself?** → **[docs/internals/](docs/internals/)** —
  [architecture](docs/internals/architecture.md), [protocol compliance](docs/internals/protocol-compliance.md),
  [the msg_key v1 quirk](docs/internals/msgkey-v1-quirk.md).
- Full index: **[docs/README.md](docs/README.md)**.

## Repo tasks

```bash
yarn install
yarn test         # all workspaces (vitest)
yarn typecheck    # all workspaces (tsc)
yarn gen:types    # regenerate the example app's types from its schema
yarn freeze 205   # freeze the app's schema into a layer snapshot
```

No build step — `tsx` runs the TypeScript directly. Stack: Node 20+ / TypeScript,
Yarn 4 workspaces; `ws` + raw TCP, `mongodb` + `ioredis` (presence + Redis pub/sub
update bus), built-in `crypto` (bigint/buffer helpers are pure JS — no native
modules). The protocol engine + your handlers run in one process.

## Wire-compatibility

Crypto and framing reproduce the legacy MTProto server byte-for-byte (DH
prime, AES-IGE, msg_key derivation, salt math, constructor ids), pinned by
known-answer tests. Existing clients pin a specific server RSA key — point
`RSA_PRIVATE_KEY_PATH` at the production PEM so the advertised fingerprint matches.
