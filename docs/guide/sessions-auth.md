# Sessions & authentication

How a connection becomes an authenticated user, and how you gate methods behind that.
Auth here is **not** a hook you write — the engine enforces it in dispatch, and you
drive it with a single call: `ctx.login(subject)`.

## The model in one paragraph

Every connection has an **auth key** (established by the protocol handshake). A fresh
key is **anonymous** — no user. When a login handler calls `ctx.login(subject)`, the
engine **binds** that `subject` to the auth key, persists it, and carries it in
`ctx.subject` on every later request from that key. Methods marked `auth: true` (the
default) are rejected for anonymous keys _before your handler runs_. That's the whole
system: an anonymous-allowed login flow that binds a subject, and everything else
defaulting to "must be bound".

## `subject`: your internal user id (not the wire `user_id`)

The `subject` is **your application's internal user id** — an opaque `string` the
framework never interprets. It's the _only_ identity the engine holds: it binds it to
the auth key, keys presence/server-push by it, and stamps it on every `ctx`. Because
it's internal, it's the id you're free to **share across your services** (a uuid, a
stringified primary key, whatever your backend already uses). It never goes on the TL
wire.

That is deliberately **separate** from the **`user_id` in your TL schema**. In a
Telegram-style app (like the demo), `user.id` / `inputUser.user_id` are an `int`
(Telegram itself recently moved to `long`) — public, client-visible, part of your wire
contract. Clients send that int back in `inputUser`; they never see your internal id.

|             | `subject` (this framework)                | `user_id` (your TL schema)                       |
| ----------- | ----------------------------------------- | ------------------------------------------------ |
| Type        | `string` (opaque — uuid, etc.)            | whatever your `.tl` says — `int`/`long`/`string` |
| Who sees it | your services only                        | the client (it's on the wire)                    |
| Bound by    | `ctx.login(subject)`                      | nobody — it's just a field in params/results     |
| Used for    | auth-key binding, presence, push, pts log | identifying users _in TL method payloads_        |

**Why split them?** The protocol runs entirely on your stable internal id, while the
public id stays whatever your wire contract needs — change one without touching the
other. The gateway forwards your TL params verbatim (it never inspects `user_id`), so
the two ids meet in exactly **one place you control — your handler**.

### Linking the two in your DB

Your user row holds **both** ids, so a handler can translate at the edge:

```ts
export interface StoredUser {
    _id: number // PUBLIC TL user.id (int) — what the client sees in `inputUser`
    subject: string // INTERNAL id (uuid) — what ctx.login binds & services share
    // …profile fields…
}

// Two lookups — one per id:
getById(id: number): Promise<StoredUser | null> // public int  → user
getBySubject(subject: string): Promise<StoredUser | null> // internal uuid → user
```

On sign-up the row mints both at once; the login handler binds the **internal** one
while returning the **public** one to the client:

```ts
app.method('crypto.signIn', { auth: false }, async (params, ctx) => {
    const { subject, user } = await auth.signIn(params) // subject=uuid, user.id=public int
    ctx.login(subject) // bind the INTERNAL id
    return { _: 'auth.authorization', user } // client only ever sees the public int
})
```

Later, a method that takes an `inputUser` translates right there — the only spot the
two ids touch:

```ts
app.method('users.getFullUser', async (params, ctx) => {
    // params.id.user_id — the PUBLIC int the client sent (wire).
    // ctx.subject       — the INTERNAL uuid the engine bound to this auth key.
    const id = params.id as { user_id?: number }
    const stored =
        typeof id?.user_id === 'number'
            ? await users.byId(id.user_id) // public int  → user
            : await users.bySubject(ctx.subject!) // internal uuid → "me"
    if (!stored) throw new NotFoundError('USER_NOT_FOUND')
    return toFullUser(stored, stored.subject === ctx.subject)
})
```

> If your public ids are guessable (small ints), gate `byId(user_id)` behind an
> `access_hash` (or your own capability check) the same way Telegram does — that's
> your handler's job, not the framework's.

## `auth` on a method

`auth` defaults to `true`. The engine checks it in dispatch, _before_ any pre-handler
or your handler:

```ts
// default: requires a bound subject (else rpc_error 401 AUTH_KEY_UNREGISTERED)
app.method('account.getAccountTTL', async (_p, ctx) => ({
    _: 'accountDaysTTL',
    days: await account.ttl(ctx.subject!), // ctx.subject is guaranteed here
}))

// the login flow must be reachable by an anonymous key:
app.method('crypto.signIn', { auth: false }, async (params, ctx) => {
    const { subject, user } = await auth.signIn(params)
    ctx.login(subject)
    return { _: 'auth.authorization', user }
})
```

Rule of thumb: `auth: false` for the login/registration flow (`crypto.*`), default
`true` for everything else. For checks _richer_ than "is the key bound?" — ownership,
balance, "load the current user once" — use a **pre-handler**, which runs after the
auth gate with the same `ctx`. See [methods → hooks](adding-methods.md#hooks-pre-handlers).

## Session effects

`ctx.login` / `ctx.logout` / `ctx.revoke` don't mutate state inline — they record a
**session effect** the engine applies to the auth key _after_ your handler returns
(alongside the result). This keeps the engine agnostic to your auth scheme: the
handler just says what should happen.

| Call                 | Effect       | Meaning                                       |
| -------------------- | ------------ | --------------------------------------------- |
| `ctx.login(subject)` | `bindUser`   | bind the auth key to a subject (device login) |
| `ctx.logout()`       | `unbindUser` | unbind — the key is anonymous again           |
| `ctx.revoke()`       | `revokeKey`  | revoke the auth key entirely                  |

```ts
app.method('auth.logOut', async (_p, ctx) => {
    ctx.logout() // applied by the engine after this returns
    return { _: 'boolTrue' }
})
```

Auth key = device login (MTProto semantics): binding a subject authorizes **all**
sessions on that key.

## What persists where

- The **auth key → subject** binding is durable: with `storage.backend: 'mongo'` it
  survives restarts and is shared across instances, so any replica recognises the
  user. With `memory` it's per-process (dev only). See [configuration](configuration.md#storage).
- A client's **negotiated layer** rides in `ctx.layer` (read-only) — you only read it.

## End to end: the login flow

The [demo app](the-demo-app.md) implements an EOS-seed flow you can read in full
(that crypto scheme is the _demo's_ choice — the framework is auth-agnostic, you bring
any scheme). The shape is:

1. Client calls `crypto.sendCode` (`auth: false`) → server signs a code.
2. Client calls `crypto.signIn` / `signUp` (`auth: false`) with the proof.
3. The handler verifies it, resolves/creates the user, and calls `ctx.login(subject)`
   with the user's **internal** id.
4. The engine binds `subject` to the auth key. Every later request now arrives with
   `ctx.subject` set, so default-`auth` methods just work — while the client only ever
   holds the **public** `user.id` returned in `auth.authorization`.

---

**Next:** [server-push →](server-push.md)
