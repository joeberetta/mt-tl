# FAQ

Real questions that come up while building and shipping. If yours isn't here, the
linked pages go deeper.

## Getting started

### Do I need to understand the handshake, crypto, or sessions?

No. The framework owns the entire protocol; you write methods. That's the whole point
— see [how it works](core-concepts.md). The internals are documented under
[architecture](../internals/architecture.md) only if you're curious or contributing.

### How is this different from gRPC / REST?

MTProto is a stateful, binary, encrypted protocol over a long-lived socket, with a
built-in auth-key handshake, sessions, and a versioned binary schema (TL) negotiated
per client. It's what Telegram clients already speak. If your goal is "a Telegram-class
client talks to my backend", you need MTProto, not REST — and this framework gives you
the REST-like _ergonomics_ (`app.method`, handlers) on top of it.

### Can I build my own app, or only a Telegram clone?

Your own. The framework is the transport + protocol; **the API surface is entirely
yours** — you define it in your `.tl` schema. The demo happens to look Telegram-ish
because that's the familiar shape, but nothing forces it. Build whatever methods and
updates your product needs.

### I don't have a client yet — how do I test the server?

Use [`@mt-tl/testing`](testing.md): it ships a real handshaking client you drive from
code or from YAML scenarios, in-process or against a deployed stand. You don't need a
mobile app to exercise the full crypto path.

## Auth & users

### Why are there two ids — `subject` and `user_id`?

`subject` is your **internal** id (opaque string) the framework binds to the auth key
and uses for presence/push; `user_id` is the **public** id in your TL schema that
clients see and send back. Keeping them apart means the protocol runs on a stable
internal id while the wire id stays whatever your contract needs. Full explanation:
[sessions & auth](sessions-auth.md#subject-your-internal-user-id-not-the-wire-user_id).

### How do I implement my own login scheme (not the demo's EOS seed)?

The framework is auth-agnostic. Mark your login methods `auth: false`, verify whatever
proof you like (password, OTP, signature, OAuth exchange), then call
`ctx.login(subject)` with your user's internal id. The demo's EOS-seed flow is just
one example — see [sessions & auth → the login flow](sessions-auth.md#end-to-end-the-login-flow).

### How do I log a user out of all devices?

Auth key = device. `ctx.logout()` unbinds the current key; `ctx.revoke()` kills it. To
drop _all_ of a user's devices, look up every auth key bound to that `subject` and
revoke each (your app drives this through a method). See
[session effects](sessions-auth.md#session-effects).

### My public `user_id`s are small ints — aren't they guessable?

Yes, so gate any `byId(user_id)` lookup behind an `access_hash` or your own capability
check, exactly as Telegram does. That's your handler's job, not the framework's.

## Realtime

### Live push is best-effort — won't I lose updates?

You won't lose _state_, only the live notification. Clients resync on reconnect via
your app's `getDifference` (a `pts` log you maintain). Implement
`updates.getState` / `updates.getDifference` as normal methods and embed `pts` in what
you push. See [server-push → catch-up](server-push.md#catch-up-live-push-is-best-effort).

### How do I push to another user from a handler?

Translate the recipient's public wire id to its `subject`, then `ctx.push(subject, …)`
— the push path is keyed by your internal id. See
[server-push](server-push.md#from-a-handler--ctxpush).

### How do I push from a webhook / cron / another service?

Use `createUpdatePublisher({ redisUrl })` and `push(subject, update)`. It needs a
**shared Redis bus** so the push reaches whichever replica holds the user. See
[server-push](server-push.md#from-another-process--createupdatepublisher).

### Can I push to a client that hasn't logged in yet?

Yes — push by **auth key** (`ctx.pushToAuthKey`), e.g. mid-registration. It's
live-only (that one connection, if online). See
[server-push](server-push.md#pushing-to-anonymous-connections-by-auth-key).

## Schema & versioning

### What is a "layer"?

A numbered, frozen snapshot of your TL schema. Clients announce the layer they were
built against, and the server encodes replies in that shape so old clients keep
working. See [schema versions & layers](releasing-a-version.md#what-a-layer-is).

### When do I need to `freeze`?

Every time you ship a layer to clients. Decoding is layer-agnostic, but _encoding_ to
old clients needs the frozen snapshot. Always freeze the newest shipped layer too.

### When do I need a migration ladder vs. just freezing?

Freezing alone handles types that only **gained** fields. You need a ladder only for
a **non-additive** change (a field removed or its type changed). The ladder keeps your
handlers seeing one canonical shape. See
[migration ladders](releasing-a-version.md#migration-ladders).

### How do I test that two clients on different layers interoperate?

Connect each test user at a different layer in one scenario (`users.<name>.layer`), or
in code via `connect({ layer })`. See [testing](testing.md) and the
[`@mt-tl/testing` README](https://github.com/joeberetta/mt-tl/blob/master/packages/testing/README.md).

## Infrastructure & scaling

### Do I need MongoDB? Redis?

- **Mongo** — only once you run **more than one replica** (shared auth keys / sessions
  / salts). A single dev instance can use `memory`.
- **Redis** — only for **server-push across replicas** (presence + the pub/sub bus).
  No push, or single process → not required.

See [configuration](configuration.md#storage) and [deployment](deployment.md#prerequisites).

### What breaks if Redis goes down?

Only **live** updates are dropped; clients recover via `getDifference` on reconnect.
Requests, auth, and durable state are unaffected. Live push is best-effort by design.

### How do replicas share state — do I need sticky sessions?

No. All shared state is in Mongo/Redis, so **any replica serves any client at any
layer** — the load balancer can fan connections freely. The layer is negotiated inside
the encrypted stream, so there's no per-layer routing at the edge. See
[system design](system-design.mdx).

### Can I split media / heavy domains onto their own instances (like Telegram's DCs)?

Yes. A plugin is just "routes + deps", so you can stand up a second `createServer` on
its own port/DC that registers only that domain's plugins. See
[methods → grow the structure](adding-methods.md#grow-the-structure-as-you-go).

### What do I configure behind nginx / HAProxy?

Set `trustProxy: true` and forward `X-Forwarded-For` (WebSocket) or enable the PROXY
protocol (raw TCP) upstream, so `ctx.request.ip` is the real client. See
[deployment → behind a proxy](deployment.md#behind-a-proxy-nginx--haproxy).

## Clients & security

### Why do clients pin my RSA key, and where do I get it?

Existing MTProto clients refuse to handshake unless the server's advertised RSA
fingerprint matches the one they pin. Use the **same production PEM on every replica**
(`rsaKeyPath`). Without it the server generates an ephemeral key each boot, which only
test clients accept. See [configuration](configuration.md#the-rsa-key-wire-compat).

### What is `disableMsgKeyCheck` and should I use it?

It drops the inbound `msg_key` integrity check — an **insecure** interop shim for a
client that computes `msg_key` the old (MTProto 1.0) way. Keep it `false` in
production. See [configuration → escape hatches](configuration.md#escape-hatches-secure-by-default).

---

See also: [configuration](configuration.md) · [production checklist](production-checklist.md) · [the demo app](the-demo-app.md).
