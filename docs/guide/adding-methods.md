# Methods, context & errors

This is where your app's behaviour lives: routes, the handler context, errors,
reusable hooks, and how to structure it all as the app grows. The protocol core is
generic — you only write methods. The reference app is
[`examples/demo-eos-seed-app`](https://github.com/joeberetta/mt-tl/tree/master/examples/demo-eos-seed-app).

## Routes

A route is one TL method → one handler. `auth` defaults to `true`.

```ts
app.method('account.getAccountTTL', async (params, ctx) => {
    return { _: 'accountDaysTTL', days: await account.ttl(ctx.subject!) }
})

app.method('crypto.signIn', { auth: false }, async (params, ctx) => {
    const { subject, user } = await auth.signIn(params)
    ctx.login(subject) // bind the auth key to this subject
    return { _: 'auth.authorization', user }
})
```

`createServer<RpcMethods>(...)` types every route by the generated `RpcMethods`: the
method name must exist, `params` is the method's param type, and the return must be
its result type. Run `gen:types` after editing the schema.

## Context

Every handler (and hook) receives `ctx` — request-scoped and cross-cutting concerns.
It **never** carries your services; a handler closes over those. This is the full
surface:

| `ctx` member                                   | What it is                                                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.subject`                                  | the bound **subject** — your internal user id (string), or `undefined` (anonymous). _Not_ the wire `user_id` — see [sessions & auth](sessions-auth.md#subject-your-internal-user-id-not-the-wire-user_id) |
| `ctx.layer`                                    | the client's negotiated TL layer (read-only) — branch on it to shape a response for an old client                                       |
| `ctx.login(subject)` / `logout()` / `revoke()` | session effects, applied by the engine after the handler returns — see [sessions & auth](sessions-auth.md#session-effects)               |
| `ctx.push(subject, update)`                    | server-push a TL update — see [server-push](server-push.md)                                                                              |
| `ctx.pushToAuthKey(authKeyId, update)`         | push to one connection by auth key (pre-login delivery) — see [server-push](server-push.md#pushing-to-anonymous-connections-by-auth-key)|
| `ctx.set(key, val)` / `ctx.get<T>(key)`        | per-request value bag (pre-handler → handler)                                                                                           |
| `ctx.log`                                      | a request-scoped logger, pre-bound with the request identity — see [observability](observability.md#in-your-handlers-ctxlog)            |
| `ctx.request`                                  | the raw context the engine forwarded (`authKeyId`, `sessionId`, `ip`, …)                                                                |

`ctx.layer` is read-only — layer negotiation is the protocol's job; you only read it,
e.g. to shape a response for an old client:

```ts
return ctx.layer < 200 ? legacyShape(data) : modernShape(data)
```

(If a field's _shape_ changed between layers, prefer a migration ladder over branching
by hand — see [schema versions & layers](releasing-a-version.md#migration-ladders).)

## Auth on a method

`auth` is **not** a hook — the engine enforces it in dispatch, _before_ any
pre-handler or your handler runs. A method with `auth: true` (the default) on a
connection whose auth key has no bound `subject` is rejected with
`rpc_error 401 AUTH_KEY_UNREGISTERED`; the handler never runs. So: `auth: false` for
the login flow (`crypto.*`), default `true` for everything else — and an `auth: true`
handler can treat `ctx.subject` as present (`ctx.subject!`). The whole auth model is
in [sessions & auth](sessions-auth.md).

## Errors

Throw an `AppError` subclass; the code/message map straight to `rpc_error`:

| Throw                       | → `rpc_error`    |
| --------------------------- | ---------------- |
| `BadRequestError('CODE')`   | 400 CODE         |
| `AuthRequiredError('CODE')` | 401 CODE         |
| `NotFoundError('CODE')`     | 404 CODE         |
| `FloodWaitError(seconds)`   | 420 FLOOD_WAIT_X |

Anything else → `500 INTERNAL` (the client never sees your stack; the failed request
is logged as `handler.fail` — see [observability](observability.md)). Keep error logic
in the service; the handler stays thin.

## Hooks (pre-handlers)

A **hook** runs before the handler with the same `ctx`. It can reject (throw) or pass
data forward (`ctx.set`). Hooks are reusable across methods — the place for
cross-cutting checks _beyond_ "is there a user" (`auth` already answers that):
ownership, balance, rate-limit, "load the current user once":

```ts
// hooks.ts — fetch the user once, reject if missing, stash for the handler
export const requireBalance = defineHook(async (_params, ctx) => {
    const balance = await wallets.balanceOf(ctx.subject!)
    if (balance <= 0n) throw new BadRequestError('NOT_ENOUGH_BALANCE')
    ctx.set('balance', balance)
})

app.method('wallets.withdraw', { preHandlers: [requireBalance] }, async (params, ctx) => {
    const balance = ctx.get<bigint>('balance') // already fetched — no re-query
    // …
})
```

Hooks are plain async functions that close over their services, so DB access is
exactly as in a handler. They're method-agnostic, so their `params` is `unknown`
(narrow it if a hook needs them); the handler keeps full typing.

### Extending the context

The canonical hook: load the current user **once** so every handler doesn't re-fetch
it. Pair the hook with a tiny typed accessor so reads stay type-safe:

```ts
// hooks.ts — a hook factory (takes the service) + a typed accessor
export const loadCurrentUser = (users: UserService) =>
    defineHook(async (_p, ctx) => {
        if (ctx.subject === undefined) throw new AuthRequiredError('AUTH_REQUIRED')
        const user = await users.bySubject(ctx.subject) // internal id → user
        if (!user) throw new NotFoundError('USER_NOT_FOUND')
        ctx.set('currentUser', user) // stash it for the handler
    })

export const currentUser = (ctx: HandlerCtx): StoredUser => ctx.get<StoredUser>('currentUser')!
```

```ts
// plugin — attach the hook, then read the typed user; no DB call in the handler
app.method('account.updateProfile', { preHandlers: [loadCurrentUser(users)] }, async (params, ctx) => {
    const me = currentUser(ctx) // typed StoredUser, already fetched
    return account.update(me, params)
})
```

The accessor (`currentUser(ctx)`) is the recommended pattern — `ctx.get('...')` is
stringly-typed, so wrap each stashed value in a typed reader.

## Structure: services vs controllers

As the app grows, split it into two layers, two directories:

- **`modules/`** — your **domain**: services, repos, mappers. No TL, no `ctx`, no
  routes. A service is plain business logic you can unit-test in isolation.
- **`plugins/`** — **controllers**: only `app.method(...)`. A controller takes the
  services it needs as dependencies and turns them into routes.

The composition root (`app.ts`) is the whole wiring graph: build the services, then
register the controllers, passing each the services it needs (deps by value — no
decorators, no magic):

```ts
// app.ts
const users = new UserService(repo) // 1. services (domain)
const auth = buildAuthService({ users /* … */ }) //    auth consumes users
app.register(usersPlugin, { users }) // 2. controllers (routes)
app.register(authPlugin, { auth })
app.register(walletsPlugin) //    no deps
```

Why split them? A **controller can compose any services**, so a cross-cutting route
doesn't force one domain module to import another.

> **When does this run?** `app.register(plugin, deps)` runs the plugin body
> **synchronously, at composition time — before `listen()`**, not per-request. So
> services don't "appear after bootstrap": the root builds them first, then hands each
> plugin the ones it declared. A hook built inside, like `loadCurrentUser(users)`,
> simply closes over that instance. Services come from a plugin's `deps`, never from
> `ctx` (ctx is request-scoped only).

### Avoiding cycles

A service cycle (`UserService` ↔ `MessageService` import each other) is a design
smell, not a framework limit. Resolve it in this order:

1. **Orchestrate in the controller** (preferred — no service-to-service link at all).
   Need a profile = user + their last message? The _controller_ calls both services
   and combines them; neither references the other:

    ```ts
    export const profilePlugin = definePlugin<{ users: UserService; messages: MessageService }>(
        (app, { users, messages }) => {
            app.method('users.getFullUser', async (p, ctx) => {
                const user = await users.bySubject(ctx.subject!)
                const last = await messages.lastMessage(ctx.subject!) // orchestration here
                return buildFullUser(user, last)
            })
        },
    )
    ```

2. **Depend on a port the consumer declares** when a service genuinely needs another
   inline. The service declares an interface (the port); the root wires the
   implementation — so there's no module→module import:

    ```ts
    export interface UserLookup {
        byId(id: number): Promise<User | null>
    }
    export class MessageService {
        constructor(private users: UserLookup) {} // UserService satisfies it structurally
    }
    ```

3. **Lazy thunk** for a true runtime cycle (rare) — pass `() => otherService` and
   resolve it on first use.

Rule of thumb: most "links" between services are really _orchestration_ — and
orchestration belongs in a controller. Keep data with its owner; do cross-domain
workflows via [server-push](server-push.md), not direct cross-service calls.

### Grow the structure as you go

Nothing forces this up front:

1. **Start co-located** — a tiny app keeps a service + its routes in one file.
2. **Split into `modules/` + `plugins/`** when domains multiply (the demo is here).
3. **Extract a domain to its own instance** when one part must scale or deploy on its
   own. Because a plugin is just "routes + deps", you stand up a _second_
   `createServer` — on its own port/DC — that registers only that domain's plugins
   (this mirrors Telegram's media-DC split). On a _single_ port it's still one server
   with many plugins; you only reach for a second instance when you want real
   isolation, never "two servers on one port".

## Where things live (in the demo)

| Concern                                                       | Location                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| Your `.tl` schema + generated types + `gen:types`/`freeze`    | `schema/`, `src/generated/`, `scripts/`                   |
| `MTProtoConfig` (`loadConfig`) + framework binding + entrypoint | `src/{config.ts,framework.ts,main.ts}`                    |
| **Services** (domain: service / repo / mapper, no routes)     | `src/modules/{auth,users,account,help}`                   |
| **Controllers** (`app.method` routers, take services as deps) | `src/plugins/*.plugin.ts`                                 |
| Composition root (`demoApp` plugin) + shared hooks            | `src/{app.ts,hooks.ts}`                                   |

---

**Next:** [sessions & authentication →](sessions-auth.md)
