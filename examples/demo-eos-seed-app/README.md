# demo-eos-seed-app

A reference business app built on the **mt-tl framework** (`@mt-tl/server` + `@mt-tl/tl`). It's the starting point for your own app — copy it, put your
`.tl` schema in `schema/` (the protocol layer is bundled in the framework; you
ship only business methods), run `yarn gen:types`, and replace these modules with
yours. New here? Start with the [5-minute guide](../../docs/guide/getting-started.md).

It implements EOS-seed auth (the `crypto.*` register/login flow) plus the handful
of methods a client needs to reach its main screen.

## Layout

```
schema/                       THIS app's business .tl (+ layers/) — no protocol here
scripts/                      gen-types.ts, freeze.ts (wrap @mt-tl/tl tooling)
src/
  schema.ts                   exports schemaDir / layersDir
  generated/schema.ts         generated TS types (RpcMethods) — `yarn gen:types`
  config.ts                   loadConfig(): builds the MTProtoConfig from env
  framework.ts                createServer / definePlugin pinned to RpcMethods
  hooks.ts                    reusable pre-handlers (e.g. requireUser)
  app.ts                      demoApp plugin (composition root) + buildDemoApp (test helper)
  main.ts                     entrypoint: createServer(config).register(demoApp,…).listen()
  modules/                    DOMAIN services only — no routes
    auth/      AuthService (eosjs-ecc code signer)
    users/     UserService + repo (memory/Mongo) + TL mapper
    account/   AccountService
    help/      buildConfig (config payload)
  plugins/                    CONTROLLERS — app.method routers; take services as deps
    auth.plugin.ts      crypto.sendCode / signIn / signUp
    users.plugin.ts     users.getFullUser
    account.plugin.ts   account.checkFields / registerDevice / updateStatus
    help.plugin.ts      help.getConfig / getServerConfig / getAppUpdate
    wallets.plugin.ts   wallets.* (stub, no service)
    updates.plugin.ts   updates.getState (stub)
    messages.plugin.ts  messages.getDialogs (stub)
```

Two layers: **`modules/`** is your domain (services, repos — no TL, no routing),
**`plugins/`** is the controllers (only `app.method`, take services as deps). A
controller can compose any services, so cross-cutting routes don't force one
module to import another. See
[avoiding cycles](../../docs/guide/adding-methods.md#structure-services-vs-controllers).

## Run

Self-contained: its `.env.example`, `Dockerfile`, and `docker-compose*.yml` live
right here.

```bash
yarn install                      # from the repo root (Yarn workspaces)
cd examples/demo-eos-seed-app
docker compose up -d              # mongo:27017, redis:6380
cp .env.example .env              # then set CHAT_SERVER_SEED (any value in dev)
yarn serve                        # createServer(config).register(demoApp).listen()
```

`CHAT_SERVER_SEED` (the server's EOS seed) is required. For a real client set
`RSA_PRIVATE_KEY_PATH` to the production PEM. Scaling + containers:
[../../docs/guide/deployment.md](../../docs/guide/deployment.md).

## Add a method

Domain logic in a **service** (`modules/`), routes in a **controller** (`plugins/`):

```ts
// modules/account/account.service.ts — business logic (no TL, no ctx)
export class AccountService {
    constructor(private readonly users: UserService) {}
    async ttl(subject: string): Promise<number> {
        /* … */ return 365
    }
}

// plugins/account.plugin.ts — the controller; declares the services it needs
export const accountPlugin = definePlugin<{ account: AccountService }>((app, { account }) => {
    app.method('account.getAccountTTL', async (_p, ctx) => ({
        _: 'accountDaysTTL',
        days: await account.ttl(ctx.subject!), // ctx.subject = the internal user id
    }))
})
```

Wire it in `app.ts` (build the service, register the controller — deps by value):

```ts
const account = new AccountService(users)
app.register(accountPlugin, { account })
```

**Rules** (full detail in [../../docs/guide/adding-methods.md](../../docs/guide/adding-methods.md)):

- Controller registers routes; business logic in the service; persistence in the repo.
- Effects, not mutation: `ctx.login(subject)` / `logout()` / `revoke()`. (`ctx.layer` is read-only.)
- Errors: `throw new BadRequestError('CODE')` → `rpc_error 400 CODE`.
- Reusable checks → hooks (`{ preHandlers: [requireUser] }`); server-push → `ctx.push`.
- **Avoid service cycles**: orchestrate across services in the controller, or
  depend on a _port the consumer declares_ — see
  [adding-methods.md](../../docs/guide/adding-methods.md#structure-services-vs-controllers).

## Test

```bash
yarn workspace demo-eos-seed-app run test       # service/handler units (no transport)
```

`test/demo-app.test.ts` builds the routes with `buildDemoApp(...)` and dispatches
directly. The full-stack crypto e2e (real client → server → app) lives in
`@mt-tl/server` (`packages/server/test/demo-auth.e2e.test.ts`).
