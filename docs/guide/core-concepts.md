# How it works

A mental model for `@mt-tl/server` — how the pieces fit, so you know where your code
goes and what the framework does around it. Nothing here is something you _call_;
it's the model that makes the rest of the docs click.

## The one-line model

> You write **methods**. The framework owns the **protocol**. A **forwarder**
> connects the two — in the same process.

```
client ⇄  [ protocol engine ]  →  forwarder  →  [ your methods ]
          transport · crypto ·   (in-process)    registry · hooks
          sessions · TL codec                    · handlers
```

Everything left of the forwarder ships in the box and you never touch it. Everything
right of it is your app. There's no broker and no network hop between them — a
request is a direct call.

## What the framework owns

The protocol engine is generic and complete — you neither configure nor call it:

- **Transport** — WebSocket and raw-TCP carriers, with framing.
- **Handshake** — the RSA + Diffie–Hellman auth-key exchange.
- **Crypto** — AES-IGE, `msg_key` derivation, server salts.
- **Sessions** — session + message-id tracking, and the MTProto service messages
  (acks, `bad_msg_notification`, `get_future_salts`, ping, …) answered for you.
- **TL (de)serialization** — decode the inbound method, encode your result,
  including **layered encoding** so older clients get bytes they can read.
- **Server-push routing** — deliver an update to whichever node holds the user.

You bring three things: an **`MTProtoConfig`** (see [configuration](configuration.md)),
a **`.tl` schema** (your methods), and the **handlers**.

## The building blocks you write

### Server

`createServer<RpcMethods>(config)` returns the app. Its surface is small:

```ts
const app = createServer<RpcMethods>(config)
app.method(name, opts?, handler) // register one route
app.register(plugin, deps) // run a plugin (a group of routes)
await app.listen() // open the carriers
app.inject(req) // dispatch a request with no socket (tests)
await app.close() // drain + shut down
```

`RpcMethods` is generated from your schema (`gen:types`); passing it makes every
route type-checked — the method name, its `params`, and its `result`.

### Method (route)

One TL method → one handler. `auth` defaults to `true`. Full detail in
[methods](adding-methods.md).

```ts
app.method('account.getAccountTTL', async (params, ctx) => {
    return { _: 'accountDaysTTL', days: 365 } // checked against the result type
})
```

### Plugin

A function that registers routes — your unit of modularity, like `fastify.register`.
Dependencies are explicit (the second argument), and the body runs **synchronously at
registration time, before `listen()`**:

```ts
export const walletsPlugin = definePlugin<{ wallets: WalletService }>((app, { wallets }) => {
    app.method('wallets.getBalance', async (_p, ctx) => wallets.balanceOf(ctx.subject!))
})

app.register(walletsPlugin, { wallets: new WalletService(/* … */) })
```

### Handler context (`ctx`)

Every handler receives a `ctx` carrying request-scoped and cross-cutting concerns —
the bound user (`ctx.subject`), the client's layer, session effects (`ctx.login`),
server-push (`ctx.push`), a per-request value bag, and a request-scoped logger. It
**never** carries your services — a handler closes over those. The full reference is
in [methods → context](adding-methods.md#context).

## The request lifecycle

What happens to one client call, end to end:

1. **Carrier** receives bytes (a WS frame or TCP packet) and de-frames them.
2. **Crypto** decrypts with the session's auth key and verifies `msg_key`.
3. **Session** validates the `msg_id` (replay / ordering windows) and answers any
   service messages itself.
4. **TL codec** decodes the payload to a tagged object `{ _: 'method.name', … }`.
5. **Dispatcher** classifies it: a _service_ message is answered by the engine; a
   _business_ method is handed to the **forwarder**.
6. **Forwarder** looks the method up in your registry:
    - unknown method → `404 METHOD_NOT_FOUND`;
    - `auth` required but the key is anonymous → `401 AUTH_KEY_UNREGISTERED`;
    - otherwise it runs your **pre-handlers**, then your **handler**.
7. The handler returns a result (or throws an `AppError`). Any session **effects**
   (`login`/`logout`/`revoke`) recorded on `ctx` ride back alongside it.
8. **Engine** applies the effects (e.g. binds `subject` to the auth key), encodes the
   result at the client's layer, and sends it back down the carrier.

Steps 1–5 and 8 are the framework. Steps 6–7 are your code. (The byte-level view is
in [architecture](../internals/architecture.md), if you ever want it.)

---

**Next:** [your first server →](getting-started.md)
