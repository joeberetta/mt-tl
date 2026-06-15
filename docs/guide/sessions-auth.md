# Sessions & auth

How a connection becomes an authenticated user, and how you gate methods behind
that. Auth in this framework is **not** a hook you write — the gateway enforces it
in dispatch, and you drive it with a single call: `ctx.login(subject)`.

## The model in one paragraph

Every connection has an **auth key** (established by the protocol handshake). A
fresh key is **anonymous** — no user. When a login handler calls
`ctx.login(subject)`, the gateway **binds** that `subject` to the auth key,
persists it, and carries it in `ctx.subject` on every later request from that key.
Methods marked `auth: true` (the default) are rejected for anonymous keys _before
your handler runs_. That's the whole system: an anonymous-allowed login flow that
binds a subject, and everything else defaulting to "must be bound".

## `subject`: your internal user id (not the wire `user_id`)

The `subject` is **your application's internal user id** — an opaque `string` the
framework never interprets. It's the _only_ identity the gateway holds: it binds
it to the auth key, keys presence/server-push by it, and stamps it on every
`ctx`. Because it's internal, it's the id you're free to **share across your
services** (a uuid, a stringified primary key, whatever your backend already
uses). It never goes on the TL wire.

That is deliberately **separate** from the **`user_id` in your TL schema**. In a
Telegram-style app (like the demo), `user.id` / `inputUser.user_id` are an `int`
(Telegram itself recently moved to `long`) — public, client-visible, and part of
your wire contract. Clients send that int back in `inputUser`; they never see your
internal id.

|             | `subject` (this framework)                | `user_id` (your TL schema)                       |
| ----------- | ----------------------------------------- | ------------------------------------------------ |
| Type        | `string` (opaque — uuid, etc.)            | whatever your `.tl` says — `int`/`long`/`string` |
| Who sees it | your services only                        | the client (it's on the wire)                    |
| Bound by    | `ctx.login(subject)`                      | nobody — it's just a field in params/results     |
| Used for    | auth-key binding, presence, push, pts log | identifying users _in TL method payloads_        |

**Why split them?** The protocol runs entirely on your stable internal id, while
the public id stays an `int` for wire-compat — change one without touching the
other. Keep them apart and there's no "каша": the gateway forwards your TL params
verbatim (it never inspects `user_id`), and the two ids meet in exactly **one
place you control — your handler**.

### Linking the two in your DB

Your user row holds **both** ids, so a handler can translate at the edge. From the
demo's [`user.repo.ts`](https://github.com/joeberetta/mt-tl/blob/master/examples/demo-eos-seed-app/src/modules/users/user.repo.ts):

```ts
export interface StoredUser {
    _id: number       // PUBLIC TL user.id (int) — what the client sees in `inputUser`
    subject: string   // INTERNAL id (uuid) — what ctx.login binds & services share
    // …profile fields…
}

// Two lookups — one per id:
getById(id: number): Promise<StoredUser | null>          // public int  → user
getBySubject(subject: string): Promise<StoredUser | null> // internal uuid → user
```

On sign-up the row mints both at once; the login handler binds the **internal**
one while returning the **public** one to the client:

```ts
app.method('crypto.signIn', { auth: false }, async (params, ctx) => {
    const { subject, user } = await auth.signIn(params) // subject=uuid, user.id=public int
    ctx.login(subject) // bind the INTERNAL id
    return { _: 'auth.authorization', user } // client only ever sees the public int
})
```

Later, a method that takes an `inputUser` translates right there — the only spot
the two ids touch ([`users.plugin.ts`](https://github.com/joeberetta/mt-tl/blob/master/examples/demo-eos-seed-app/src/plugins/users.plugin.ts)):

```ts
app.method('users.getFullUser', async (params, ctx) => {
    // params.id.user_id — the PUBLIC int the client sent (wire).
    // ctx.subject       — the INTERNAL uuid the gateway bound to this auth key.
    const id = params.id as { user_id?: number }
    const stored =
        typeof id?.user_id === 'number'
            ? await users.byId(id.user_id) // public int  → user
            : await users.bySubject(ctx.subject!) // internal uuid → "me"
    if (!stored) throw new NotFoundError('USER_NOT_FOUND')

    // "self" compares the INTERNAL id; the rendered user.id is the public int.
    return toFullUser(stored, stored.subject === ctx.subject)
})
```

> If your public ids are guessable (small ints), gate `byId(user_id)` behind an
> `access_hash` (or your own capability check) the same way Telegram does — that's
> your handler's job, not the framework's.

## `auth` on a method

`auth` defaults to `true`. The gateway checks it in dispatch, _before_ any
pre-handler or your handler:

```ts
// default: requires a bound subject (else rpc_error 401 AUTH_KEY_UNREGISTERED)
app.method('account.getAccountTTL', async (_p, ctx) => ({
    _: 'accountDaysTTL',
    days: await account.ttl(ctx.subject!), // ctx.subject is guaranteed here
}))

// the login flow must be reachable by an anonymous key:
app.method('crypto.signIn', { auth: false }, async (params, ctx) => {
    const { subject, user } = await auth.signIn(params)
    ctx.login(subject) // bind the auth key to this subject
    return { _: 'auth.authorization', user }
})
```

Rule of thumb: `auth: false` for the login/registration flow (`crypto.*`),
default `true` for everything else. Because the gateway enforces it, an
`auth: true` handler can treat `ctx.subject` as present (`ctx.subject!`).

## Session effects

`ctx.login` / `ctx.logout` / `ctx.revoke` don't mutate state inline — they record
a **session effect** that the gateway applies to the auth key _after_ your handler
returns (alongside the result). This keeps the gateway agnostic to your auth
scheme: the handler just says what should happen.

| Call                 | Effect       | Meaning                                       |
| -------------------- | ------------ | --------------------------------------------- |
| `ctx.login(subject)` | `bindUser`   | bind the auth key to a subject (device login) |
| `ctx.logout()`       | `unbindUser` | unbind — the key is anonymous again           |
| `ctx.revoke()`       | `revokeKey`  | revoke the auth key entirely                  |

```ts
app.method('auth.logOut', async (_p, ctx) => {
    ctx.logout() // applied by the gateway after this returns
    return { _: 'boolTrue' }
})
```

(`bindUser` / `unbindUser` / `revokeKey` exist as deprecated aliases — prefer
`login` / `logout` / `revoke`.)

## What persists where

- The **auth key → subject** binding is durable: with `storage.backend: 'mongo'`
  it survives restarts and is shared across instances, so any replica recognises
  the user. With `memory` it's per-process (dev only).
- A client's **negotiated layer** rides in `ctx.layer` (read-only) — layer
  negotiation is the protocol's job; you only read it to shape a response for an
  old client.

## Checks beyond "is there a user"

`auth` only answers _is the key bound?_ For anything richer — ownership, balance,
rate limits, "load the current user once" — use a **pre-handler** (hook), which
runs after the auth gate with the same `ctx`:

```ts
export const loadCurrentUser = (users: UserService) =>
    defineHook(async (_p, ctx) => {
        if (ctx.subject === undefined) throw new AuthRequiredError('AUTH_REQUIRED')
        const user = await users.bySubject(ctx.subject) // internal id → user
        if (!user) throw new NotFoundError('USER_NOT_FOUND')
        ctx.set('currentUser', user) // stash for the handler
    })

app.method('account.updateProfile', { preHandlers: [loadCurrentUser(users)] }, async (params, ctx) => {
    const me = ctx.get<StoredUser>('currentUser')!
    return account.update(me, params)
})
```

Hooks, the value bag, and the typed-accessor pattern are covered in
[Defining methods → Hooks](adding-methods.md#hooks-pre-handlers).

## End to end: the login flow

The [demo app](the-demo-app.md) implements an EOS-seed flow you can read in full;
the shape is:

1. Client calls `crypto.sendCode` (`auth: false`) → server signs a code.
2. Client calls `crypto.signIn` / `signUp` (`auth: false`) with the proof.
3. The handler verifies it, resolves/creates the user, and calls
   `ctx.login(subject)` with the user's **internal** id.
4. The gateway binds `subject` to the auth key. Every later request now arrives
   with `ctx.subject` set, so default-`auth` methods just work — while the client
   only ever holds the **public** `user.id` returned in `auth.authorization`.

## See also

- **[Core concepts](core-concepts.md)** — where the auth gate sits in the request
  lifecycle.
- **[Defining methods](adding-methods.md)** — hooks, errors, the value bag.
- **[The demo app](the-demo-app.md)** — a working `crypto.*` login flow.
