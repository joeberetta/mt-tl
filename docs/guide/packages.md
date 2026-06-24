# The packages

`mt-tl` is a few small packages plus a complete example app. You install **one**
(`@mt-tl/server`), use a second at build time (`@mt-tl/tl`), reach for a third when
you want full-stack tests (`@mt-tl/testing`), and an optional fourth to publish docs
for your API (`@mt-tl/studio`). Here's what each is and when to use it.

## The mental map

```
            ┌────────────────────────────────────────────────┐
your app  → │  @mt-tl/server   the whole MTProto server      │  ← you install this
            │   createServer · routes · hooks · ctx.push     │
            │   ┌──────────────────────────────────────────┐ │
            │   │ protocol engine (transport · crypto ·    │ │  ← folded in;
            │   │ sessions · TL codec · server-push)       │ │     you never call it
            │   └──────────────────────────────────────────┘ │
            └────────────────────────────────────────────────┘
   build time  →  @mt-tl/tl       .tl → TypeScript types, freeze layers
   tests (opt) →  @mt-tl/testing  real client + YAML scenarios
   docs  (opt) →  @mt-tl/studio   .tl → a static doc site + try-it playground
```

The protocol engine and your handler layer are **folded into `@mt-tl/server`** — one
install, one process. There's no separate "engine" package to wire up.

## `@mt-tl/server` — the server

What you install and build against. It gives you:

- **`createServer(config)`** — the app: register routes (`app.method`), group them
  into plugins (`app.register`), then `app.listen()`.
- **Routes & hooks** — one TL method → one handler; reusable pre-handlers for
  cross-cutting checks. See [methods](adding-methods.md).
- **Sessions & auth** — `ctx.subject`, `ctx.login/logout/revoke`. See
  [sessions & auth](sessions-auth.md).
- **Server-push** — `ctx.push` from a handler, `createUpdatePublisher` from another
  process. See [server-push](server-push.md).
- **The entire protocol** — transport, handshake, AES-IGE crypto, sessions, salts,
  service messages, TL (de)serialization, per-layer encoding — bundled and generic.
  You neither configure nor call it.
- **The logger** — `createLogger`, `ctx.log`. See [observability](observability.md).
- **Migrations** — `MigrationRegistry` for breaking schema changes. See
  [schema versions & layers](releasing-a-version.md).

```bash
npm install @mt-tl/server
```

## `@mt-tl/tl` — TL tooling (build time)

Your `.tl` schema is the contract between client and server. `@mt-tl/tl` turns it
into TypeScript and manages versioned snapshots. You mostly use two commands:

```bash
npx mt-tl gen-types ./schema ./src/generated/schema.ts   # .tl → RpcMethods + types
npx mt-tl freeze    ./schema ./schema/layers 205          # snapshot a shipped layer
```

`gen-types` emits the `RpcMethods` map you pass to `createServer<RpcMethods>()`, so
every route is type-checked. `freeze` snapshots a layer so older clients keep getting
bytes they can decode — see [schema versions & layers](releasing-a-version.md). It
also ships the bundled MTProto **protocol** schema (the fixed handshake/service
structs) and the library API the server is built on (`parseSchemaDir`,
`MigrationRegistry`, the wire codec). Install it as a dev dependency:

```bash
npm install -D @mt-tl/tl
```

## `@mt-tl/testing` — e2e tests (optional)

A dev-only toolkit for testing the **full stack** — a real handshaking client →
the engine → your handlers. Two things in one package:

- a **library** — boot your server in-process and drive it with a real client
  (`createTestServer`, `createHarness`, typed `invoke`);
- a **CLI** (`mtproto-test`) — describe a flow once in **YAML** and run it against any
  stand.

```bash
npm install -D @mt-tl/testing
```

You don't need it for fast unit tests — `app.inject` (in `@mt-tl/server`) dispatches a
request with no socket. Reach for `@mt-tl/testing` when you want to exercise the real
crypto/transport path. See [testing](testing.md).

## `@mt-tl/studio` — explore & document your API (optional)

The "Swagger/Redoc for MTProto". Point its CLI at your `.tl` layers and it builds a
**static doc site** for your API — a layer-aware reference, the full schema, an
auto-generated changelog, your prose guides, and a live **try-it playground** that
speaks real MTProto from the browser. Use it standalone (publish the static site for
your team) or alongside your gateway (run live calls against your `ws://` server).

```bash
npm install -D @mt-tl/studio
mt-tl-studio build --layers ./schema/layers --out ./site
```

Full walkthrough: [studio](studio.md).

## The example app — copy it

[`examples/demo-eos-seed-app`](https://github.com/joeberetta/mt-tl/tree/master/examples/demo-eos-seed-app)
is a complete, runnable app built on these packages: a login flow, the methods a
client needs to reach its main screen, config, schema, and deploy files. It's the
reference you copy to start your own — walked through in [the demo app](the-demo-app.md).

## Which do I install?

- **Building an app** → `@mt-tl/server` + `@mt-tl/tl` (dev).
- **Want full-stack tests** → add `@mt-tl/testing` (dev).
- **Want docs + a playground for your API** → add `@mt-tl/studio` (dev).
- That's it. There's no broker, no separate gateway, no engine package to run.

---

**Next:** [how it works →](core-concepts.md)
