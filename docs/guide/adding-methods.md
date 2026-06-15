# Adding methods

How to build your app's behaviour: routes, reusable hooks, errors, server-push,
and testing. The protocol core is generic — you only write methods. The reference
app is [`examples/demo-eos-seed-app`](https://github.com/joeberetta/mt-tl/tree/master/examples/demo-eos-seed-app).

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

`createServer<RpcMethods>(...)` types every route by the generated `RpcMethods`:
the method name must exist, `params` is the method's param type, and the return
must be its result type. Run `yarn gen:types` after editing the schema.

### Context

`ctx` carries request-scoped + cross-cutting concerns (never your services — a
handler closes over those):

- `ctx.subject` — the bound **subject** (your internal user id, an opaque string),
  or `undefined`. This is _not_ the wire `user_id` your TL schema exposes — see
  [Sessions & auth → subject vs user_id](sessions-auth.md#subject-your-internal-user-id-not-the-wire-user_id).
- `ctx.layer` — the client's negotiated TL layer (read-only). Layer negotiation is
  the protocol's job; you only _read_ it — e.g. to shape a response for an old client:
    ```ts
    return ctx.layer < 200 ? legacyShape(data) : modernShape(data)
    ```
- `ctx.login(subject)` / `ctx.logout()` / `ctx.revoke()` — session effects, applied
  by the gateway after the handler returns.
- `ctx.push(subject, update)` — server-push (below).
- `ctx.set(key, val)` / `ctx.get<T>(key)` — pass data from a pre-handler (see
  [Extending the context](#extending-the-context)).

## Auth

`auth` is **not** a hook — the gateway enforces it in dispatch, _before_ any
pre-handler or your handler runs. A method with `auth: true` (the default) on a
connection whose auth key has no bound `subject` is rejected with
`rpc_error 401 AUTH_KEY_UNREGISTERED`; the handler never runs. The `subject` is
bound by the gateway when a handler calls `ctx.login(subject)` (the `bindUser` effect),
persisted on the auth key, and carried in every later request's context. So:
`auth: false` for the login flow (`crypto.*`), default `true` for everything else.
Use pre-handlers only for checks _beyond_ "is there a user" (balance, ownership, …).

## Hooks (pre-handlers)

A **hook** runs before the handler with the same `ctx`. It can reject (throw) or
pass data forward (`ctx.set`). Hooks are reusable across methods — the place for
cross-cutting checks ("must be authed", "must have balance", rate-limit, …):

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

## Extending the context

A hook can enrich the context for the handler via `ctx.set`/`ctx.get`. The
canonical case: load the current user **once** in a hook so every handler doesn't
re-fetch it. Pair the hook with a tiny typed accessor so reads stay type-safe:

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
stringly-typed, so wrap each stashed value in a typed reader. (A fully-typed
`ctx.currentUser` would mean threading a per-route context-extension generic
through the server; the accessor gives you the same ergonomics with zero magic.)

## Errors

Throw an `AppError` subclass; the code/message map straight to `rpc_error`:

| Throw                       | → `rpc_error`    |
| --------------------------- | ---------------- |
| `BadRequestError('CODE')`   | 400 CODE         |
| `AuthRequiredError('CODE')` | 401 CODE         |
| `NotFoundError('CODE')`     | 404 CODE         |
| `FloodWaitError(seconds)`   | 420 FLOOD_WAIT_X |

Anything else → `500 INTERNAL`. Keep error logic in the service; the handler stays
thin.

## Server-push (updates)

Push a TL update to a **subject** (the internal user id). Delivery is decoupled
from where it originates — you hand it to the bus and whichever node holds that
subject delivers it (encrypted, at the client's layer). Two entry points:

```ts
// (a) inside a handler — you have ctx:
app.method('messages.sendMessage', async (params, ctx) => {
    const msg = await messages.send(params, ctx.subject!)
    // The recipient arrives as a PUBLIC id on the wire — translate to its subject
    // before pushing (the push path is keyed by your internal id, never the wire id).
    const peer = await users.byId(params.peerUserId)
    if (peer) ctx.push(peer.subject, { _: 'updateNewMessage', message: msg })
    return msg
})

// (b) outside the server — a webhook receiver, an event consumer, another service:
import { createUpdatePublisher } from '@mt-tl/server'
const updates = await createUpdatePublisher({ redisUrl: process.env.REDIS_URL })
await updates.push(subject, {
    _: 'updateNewMessage',
    message: {
        /* … */
    },
})
```

Which to use depends on **where your code is** (handler → `ctx.push`; another
process → `createUpdatePublisher`), not on instance count. Cross-process push
needs a **shared bus** (set `REDIS_URL`) — in-memory only works within one
process. A client that connected with `invokeWithoutUpdates` is excluded from
push automatically.

### Pushing to anonymous connections (by auth key)

`ctx.push` / `createUpdatePublisher().push` target a **subject**. To reach a
specific connection that isn't logged in yet — e.g. delivering API to a client
mid-registration — push by its **auth key** instead:

```ts
ctx.pushToAuthKey(ctx.request.authKeyId, { _: 'someUpdate' /* … */ })
// or cross-process: updates.pushToAuthKey(authKeyId, update)
```

Auth-key pushes are live-only — they reach that one connection if it's online, nothing more.

### Update state: `updates.getState` / `updates.getDifference`

The framework delivers updates **live and best-effort** — it keeps no durable
update state, so a client that was offline simply misses the push. If you need
catch-up, **your app owns it**: implement `updates.getState` / `updates.getDifference`
as normal methods, persist the updates you care about, and embed `pts` in what you
push. Only your app knows which entities a client must resync (messages, chats,
users, …), so it's the only place that can answer `getDifference` correctly.

## Structure: services vs controllers

Two layers, two directories:

- **`modules/`** — your **domain**: services, repos, mappers. No TL, no `ctx`, no
  routes. A service is plain business logic you can unit-test in isolation.
- **`plugins/`** — **controllers**: only `app.method(...)`. A controller takes the
  services it needs as dependencies and turns them into routes.

The composition root (`app.ts`) is the whole wiring graph: build the services,
then register the controllers, passing each the services it needs (Style-A DI —
deps by value, no decorators, no magic):

```ts
// app.ts
const users = new UserService(repo) // 1. services (domain)
const auth = buildAuthService({ users /* … */ }) //    auth consumes users
app.register(usersPlugin, { users }) // 2. controllers (routes)
app.register(authPlugin, { auth })
app.register(walletsPlugin) //    no deps
```

Why split them? A **controller can compose any services**, so a cross-cutting
route doesn't force one domain module to import another. That's the key to the
next section.

> **When does this run?** `app.register(plugin, deps)` runs the plugin body
> **synchronously, at composition time — before `listen()`**, not per-request.
> So services don't "appear after bootstrap": the composition root builds them
> first, then hands each plugin the ones it declared. That's where a plugin's
> `deps` come from — e.g. a controller needing `users` declares
> `definePlugin<{ users: UserService }>(...)`, the root calls
> `app.register(thatPlugin, { users })`, and a hook built inside like
> `loadCurrentUser(users)` simply closes over that instance. Services come from
> the plugin's `deps`, never from `ctx` (ctx is request-scoped only).

## Avoiding cycles

A service cycle (`UserService` ↔ `MessageService` import each other) is a
design smell, not a framework limit. Resolve it in this order:

1. **Orchestrate in the controller** (preferred — no service-to-service link at
   all). Need a profile = user + their last message? The _controller_ calls both
   services and combines them; neither service references the other:

    ```ts
    // plugins/profile.plugin.ts
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

2. **Depend on a port the consumer declares** when a service genuinely needs
   another inline. The service declares an interface (the port); the composition
   root wires the implementation — so there's no module→module import:

    ```ts
    // modules/messages/message.service.ts
    export interface UserLookup {
        byId(id: number): Promise<User | null>
    } // port
    export class MessageService {
        constructor(private users: UserLookup) {}
    }

    // app.ts — UserService satisfies UserLookup structurally; no cycle
    const messages = new MessageService(users)
    ```

3. **Lazy thunk** for a true runtime cycle (rare) — pass `() => otherService` and
   resolve it on first use.

Rule of thumb: most "links" between services are really _orchestration_ — and
orchestration belongs in a controller, not a service. Keep data with its owner;
do cross-domain workflows via server-push, not direct cross-service calls.

## Scaling incrementally

Grow the structure as the app grows — nothing forces it up front:

1. **Start co-located** — a tiny app can keep a service + its routes in one file.
2. **Split into `modules/` + `plugins/`** when domains multiply (the reference app
   is here): services are testable in isolation, controllers compose freely.
3. **Extract a domain to its own instance** when one part needs to scale or deploy
   on its own. Because a plugin is just "routes + deps", you stand up a _second_
   `createServer` — on its own port/DC — that registers only that domain's plugins:

    ```ts
    // a media-DC server that handles only file methods (separate process/port)
    const files = createServer<RpcMethods>(fileDcConfig)
    files.register(uploadsPlugin, { storage })
    await files.listen()
    ```

    This mirrors Telegram's media-DC split. On a _single_ port it's still one
    server with many plugins — you only reach for a second instance when you want
    real isolation (separate port/DC), never "two servers on one port".

## Testing

`app.inject(req)` dispatches a request against your routes without opening a
socket — fast unit tests, no crypto, no transport:

```ts
const app = createServer(cfg).register(demoApp, { serverSeed, ecc })
const res = await app.inject({ method: 'help.getConfig', params: {}, context: {} })
expect(res.result._).toBe('config')
```

For the full-stack crypto path (real client → engine → your handlers), use
**`@mt-tl/testing`**: an in-process server harness + a real handshaking client
(and a YAML scenario runner, `mtproto-test`). See its README for the API.

## Where things live

| Concern                                                                                      | Location                                                           |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Your `.tl` schema + generated types + `gen:types`/`freeze`                                   | `examples/demo-eos-seed-app/{schema,src/generated,scripts}`        |
| `MTProtoConfig` (`loadConfig`) + framework binding (`framework.ts`) + entrypoint (`main.ts`) | `examples/demo-eos-seed-app/src`                                   |
| **Services** (domain: service / repo / mapper, no routes)                                    | `examples/demo-eos-seed-app/src/modules/{auth,users,account,help}` |
| **Controllers** (`app.method` routers, take services as deps)                                | `examples/demo-eos-seed-app/src/plugins/*.plugin.ts`               |
| Composition root (`demoApp` plugin) + shared hooks                                           | `examples/demo-eos-seed-app/src/{app.ts,hooks.ts}`                 |

See [getting-started.md](getting-started.md) for the 5-minute start,
[releasing-a-version.md](releasing-a-version.md) for schema versions, and
[deployment.md](deployment.md) for running/scaling.
