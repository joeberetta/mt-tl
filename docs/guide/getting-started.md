# Your first server

The hands-on five-minute path: install, point the framework at a `.tl` schema,
register one route, and listen. The reference app
[`examples/demo-eos-seed-app`](https://github.com/joeberetta/mt-tl/tree/master/examples/demo-eos-seed-app)
is a complete, working version of everything below — copy it when you're ready.

## Install

```bash
npm install @mt-tl/server     # the server
npm install -D @mt-tl/tl      # type generator + codec, used by gen:types
```

(What each package does: [the packages](packages.md).)

## 1. A config

The framework reads **no environment** — you build an `MTProtoConfig` and pass it in.
This is your composition root; reading env is your app's job. A minimal config:

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
        storage: { backend: 'memory' }, // dev only; use 'mongo' for real (see below)
        updates: { enabled: false, presenceTtlMs: 60_000 },
    }
}
```

Every field is documented in the [configuration reference](configuration.md). The
defaults above run a single instance with no external services — perfect for a first
boot. For more than one replica you'll switch `storage` to `mongo`; for server-push
you'll add Redis — both covered later.

## 2. A `.tl` schema → typed methods

You own your business `.tl` (the MTProto **protocol** schema is bundled in the
framework — you never see it). Drop your methods into `schema/` and generate types:

```bash
npx mt-tl gen-types ./schema ./src/generated/schema.ts
# → RpcMethods + an interface per constructor
```

`RpcMethods` is a typed map of your methods. Pass it to `createServer<RpcMethods>()`
and every route is checked: the method name, its `params`, and its `result`.

## 3. A route

The framework decodes any method in your schema to `{ _: 'name', ...fields }` and
calls your handler. The handler returns the result object — fully typed:

```ts
import { createServer } from '@mt-tl/server'
import type { RpcMethods } from './generated/schema.js'

const app = createServer<RpcMethods>(loadConfig())

app.method('help.getConfig', { auth: false }, async () => {
    return { _: 'config' /* … */ } // checked against the method's result type
})

app.method('account.getAccountTTL', async (params, ctx) => {
    return { _: 'accountDaysTTL', days: 365 } // auth: true by default
})
```

`ctx` carries the bound user (`ctx.subject`), the client's layer, login effects, and
more — the full surface is in [methods → context](adding-methods.md#context). For
now: `auth` defaults to `true`, so `account.getAccountTTL` requires a logged-in user
and `help.getConfig` opts out with `{ auth: false }`.

## 4. Listen

```ts
await app.listen() // opens the WebSocket (+ raw-TCP) carriers
```

Point an MTProto client at `ws://localhost:8081`. That's the whole server — you wrote
two handlers and never touched transport, crypto, or sessions.

In a real app you'll group routes into **plugins** and inject services as
dependencies rather than newing them up at the call site — that's the next page. To
run a build, scale by adding replicas behind a load balancer (state shared in
Mongo/Redis); see [deployment](deployment.md).

---

**Next:** [methods, context & errors →](adding-methods.md)
