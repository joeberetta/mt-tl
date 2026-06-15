# Getting started

Build an MTProto 2.0 server the way you'd build a [Fastify](https://fastify.dev/)
app: create a server, register routes, listen. The framework handles the entire
protocol — transport, handshake, AES-IGE crypto, sessions, TL (de)serialization,
layered encoding, server-push. You never touch any of it. You write **methods**.

> You bring three things: a **config**, a **`.tl` schema** (your methods), and
> **handlers**. The reference app [`examples/demo-eos-seed-app`](https://github.com/joeberetta/mt-tl/tree/master/examples/demo-eos-seed-app)
> is a complete, working example — copy it.

## Install

Two packages to build with, plus an optional test toolkit:

```bash
npm install @mt-tl/server    # the server: createServer, routes, hooks, server-push
npm install -D @mt-tl/tl     # TL tooling: the type generator + codec (used by gen:types)
npm install -D @mt-tl/testing # optional: e2e harness + real client + YAML scenarios
```

## Hello, server

```ts
import { createServer } from '@mt-tl/server'
import type { RpcMethods } from './generated/schema.js' // generated from your .tl

const app = createServer<RpcMethods>(config)

app.method('help.getConfig', { auth: false }, async () => ({ _: 'config' /* … */ }))

await app.listen() // opens the WebSocket + raw-TCP carriers
```

That's the whole server. Point an MTProto client at `ws://localhost:8081`.

## The five steps

### 1. A config

The framework reads no environment — you build an `MTProtoConfig` and pass it in.
This is your composition root ([`src/config.ts`](https://github.com/joeberetta/mt-tl/blob/master/examples/demo-eos-seed-app/src/config.ts)):

```ts
import type { MTProtoConfig } from '@mt-tl/server'
import { schemaDir, layersDir } from './schema.js'

export function loadConfig(): MTProtoConfig {
    return {
        nodeId: 'node-1',
        wsPort: 8081,
        defaultLayer: 204,
        schemaDir, // YOUR business .tl (step 2)
        schemaLayersDir: layersDir,
        rsaKeyPath: process.env.RSA_PRIVATE_KEY_PATH,
        storage: { backend: 'mongo', mongoUrl: process.env.MONGO_URL },
        updates: { enabled: false, presenceTtlMs: 60_000 },
    }
}
```

### 2. A `.tl` schema → typed methods

You own your business `.tl` (the MTProto **protocol** schema is bundled in the
framework — you never see it). Drop your methods into [`schema/`](https://github.com/joeberetta/mt-tl/tree/master/examples/demo-eos-seed-app/schema)
and generate types:

```bash
yarn gen:types       # → src/generated/schema.ts  (RpcMethods + an interface per type)
```

`RpcMethods` is a typed map of your methods. Pass it to `createServer<RpcMethods>(...)`
and every route is checked: the method name, its `params`, and its `result`.

### 3. A route

The gateway decodes any method in your schema to `{ _: 'name', ...fields }` and
calls your handler. The handler returns the result object — fully typed:

```ts
app.method('account.getAccountTTL', async (params, ctx) => {
    return { _: 'accountDaysTTL', days: 365 } // checked against the method's result type
}) // auth: true by default
```

- **`ctx.subject`** — the bound subject (your internal user id, a string; set after
  login, `undefined` if anonymous). Not the wire `user_id` — see
  [sessions & auth](sessions-auth.md#subject-your-internal-user-id-not-the-wire-user_id).
- **`ctx.layer`** — the client's negotiated TL layer (read-only); branch on it when
  an old client needs a different response.
- **`ctx.login(subject)`** — bind the auth key to a subject (device login). Also
  `logout()`, `revoke()`.
- **Errors** — `throw new BadRequestError('CODE')` → `rpc_error 400 CODE`
  (`AuthRequiredError`=401, `NotFoundError`=404, `FloodWaitError(s)`=420).

### 4. Group routes into plugins

A **plugin** is a function that registers routes — your unit of modularity (like
`fastify.register`). DI is explicit: dependencies come in as the second argument.

```ts
export const walletsPlugin = definePlugin<{ wallets: WalletService }>((app, { wallets }) => {
    app.method('wallets.getBalance', async (_p, ctx) => wallets.balanceOf(ctx.subject!))
})

// composition root — build services, register plugins:
app.register(walletsPlugin, { wallets: new WalletService(/* … */) })
```

(`definePlugin`/`createServer` come pinned to your `RpcMethods` via a one-line
binding — see [`src/framework.ts`](https://github.com/joeberetta/mt-tl/blob/master/examples/demo-eos-seed-app/src/framework.ts).)

### 5. Listen

[`src/main.ts`](https://github.com/joeberetta/mt-tl/blob/master/examples/demo-eos-seed-app/src/main.ts):

```ts
const app = createServer(loadConfig()).register(demoApp, {
    /* deps */
})
await app.listen()
```

```bash
yarn workspace demo-eos-seed-app run serve
```

Scale by running more replicas behind a load balancer (state is shared in
Mongo/Redis).

## What's next

- **[core-concepts.md](core-concepts.md)** — the mental model behind the five
  steps above: server, plugins, the request lifecycle.
- **[adding-methods.md](adding-methods.md)** — defining methods: hooks (reusable
  pre-handlers), errors, server-push (`ctx.push` / `createUpdatePublisher`),
  testing with `app.inject`.
- **[sessions-auth.md](sessions-auth.md)** — the login flow, the `auth` gate, and
  session effects.
- **[the-demo-app.md](the-demo-app.md)** — a complete app to copy.
- **[releasing-a-version.md](releasing-a-version.md)** — evolve the schema, freeze
  a TL layer, migrations.
- **[deployment.md](deployment.md)** — scaling, server-push infra, wire-compat.

You never needed to know how the handshake, crypto, or sessions work. That's the
point. (If you're curious or maintaining the framework: [internals](../internals/architecture.md).)
