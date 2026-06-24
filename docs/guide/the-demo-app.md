# The demo app

[`examples/demo-eos-seed-app`](https://github.com/joeberetta/mt-tl/tree/master/examples/demo-eos-seed-app) is a complete,
runnable app built on the framework — the reference you copy to start your own. It
implements EOS-seed auth (the `crypto.*` register/login flow) plus the handful of
methods a client needs to reach its main screen. Everything in the other guides
appears here in working form.

Its own [README](https://github.com/joeberetta/mt-tl/blob/master/examples/demo-eos-seed-app/README.md) is the canonical
"run / develop / deploy this app". This page is the orientation: what's in it and
why it's shaped that way.

## What it demonstrates

- **The composition root** — `src/app.ts` builds the services, then registers the
  controllers, passing each the services it needs (Style-A DI, deps by value).
- **Schema-first typing** — its `.tl` lives in `schema/`; `yarn gen:types` emits
  `src/generated/schema.ts`, and `src/framework.ts` pins `createServer` /
  `definePlugin` to that `RpcMethods`.
- **The login flow** — `plugins/auth.plugin.ts` runs `crypto.sendCode` / `signIn`
  / `signUp` with `auth: false` and calls `ctx.login(subject)` with the user's
  _internal_ id, while returning the _public_ `user.id` to the client (see
  [sessions & auth](sessions-auth.md#subject-your-internal-user-id-not-the-wire-user_id)).
- **Env → `MTProtoConfig`** — `src/config.ts` reads the environment and builds the
  framework config (the framework itself reads no env).
- **In-process entrypoint** — `src/main.ts` is
  `createServer(config).register(demoApp, …).listen()` — the protocol engine and
  your handlers in one process.

## Layout

```
schema/              THIS app's business .tl (+ layers/) — no protocol here
scripts/             gen-types.ts, freeze.ts (wrap @mt-tl/tl tooling)
src/
  schema.ts          exports schemaDir / layersDir
  generated/         generated TS types (RpcMethods) — `yarn gen:types`
  config.ts          loadConfig(): builds the framework MTProtoConfig from env
  framework.ts       createServer / definePlugin pinned to RpcMethods
  hooks.ts           reusable pre-handlers
  app.ts             demoApp plugin (composition root) + buildDemoApp (test helper)
  main.ts            entrypoint: createServer(config).register(demoApp,…).listen()
  modules/           DOMAIN services only — no routes (auth, users, account, help)
  plugins/           CONTROLLERS — app.method routers; take services as deps
```

Two layers, the pattern the [Defining methods](adding-methods.md#structure-services-vs-controllers)
guide describes: **`modules/`** is your domain (services, repos — no TL, no
routing); **`plugins/`** is the controllers (only `app.method`, services injected
as deps).

## Run it

From the [README](https://github.com/joeberetta/mt-tl/blob/master/examples/demo-eos-seed-app/README.md), in short:

```bash
yarn install                      # repo root (Yarn workspaces)
cd examples/demo-eos-seed-app
docker compose up -d              # mongo + redis
cp .env.example .env              # then set CHAT_SERVER_SEED (any value in dev)
yarn serve                        # createServer(config).register(demoApp).listen()
```

Point an MTProto client at `ws://localhost:8081` (or raw TCP `:8082`). For a real
client, set `RSA_PRIVATE_KEY_PATH` to the production PEM whose fingerprint clients
pin. Scaling and containers: [deployment](deployment.md).

## Test it

```bash
yarn workspace demo-eos-seed-app run test
```

`test/demo-app.test.ts` builds the routes with `buildDemoApp(...)` and dispatches
directly (no transport, no crypto). The full-stack crypto e2e — real client →
engine → these handlers — lives in `@mt-tl/server`
(`packages/server/test/demo-auth.e2e.test.ts`). Both approaches are explained in
[testing](testing.md).

## Make it yours

Copy the directory, drop your `.tl` into `schema/`, run `yarn gen:types`, and
replace the modules and plugins with yours. The wiring (`config.ts`,
`framework.ts`, `app.ts`, `main.ts`) stays almost identical — that's the point of
copying it.

---

See also: [methods, context & errors](adding-methods.md) · [configuration](configuration.md) · [deployment & scaling](deployment.md).
