# Core concepts

A mental model for `@mt-tl/server`. After the [5-minute start](getting-started.md)
this is the page that makes the rest of the docs click. Nothing here is something
you _call_ — it's how the pieces fit, so you know where your code goes and what
the framework does around it.

## The one-line model

> You write **methods**. The framework owns the **protocol**. A **forwarder**
> connects the two — in the same process.

```
client ⇄  [ protocol engine ]  →  RpcForwarder  →  [ your methods ]
          transport · crypto ·     (in-process)     registry · hooks
          sessions · TL codec                        · handlers
```

Everything left of the forwarder ships in the box and you never touch it.
Everything right of it is your app.

## The packages

| Package              | You use it for                                                                                                          | Ships                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **`@mt-tl/server`**  | building the server: `createServer`, routes, plugins, hooks, `ctx.push`, `createUpdatePublisher`                        | the protocol engine **and** the handler layer, folded into one install |
| **`@mt-tl/tl`**      | TL tooling: the type generator (`gen:types`), the wire codec, migrations, and the bundled MTProto **protocol** schema   | —                                                                      |
| **`@mt-tl/testing`** | _(optional, dev)_ end-to-end tests: an in-process server harness, a real handshaking client, and a YAML scenario runner | —                                                                      |

You write against `@mt-tl/server` (+ `@mt-tl/tl` for codegen); reach for
`@mt-tl/testing` when you want full-stack e2e tests.

## What the framework owns

The protocol engine is generic and complete — you neither configure nor call it:

- **Transport** — WebSocket and raw-TCP carriers, with framing.
- **Handshake** — the RSA + Diffie–Hellman auth-key exchange.
- **Crypto** — AES-IGE, `msg_key` derivation, server salts.
- **Sessions** — session + message-id tracking, service messages
  (`bad_msg_notification`, acks, `get_future_salts`, …).
- **TL (de)serialization** — decode the inbound method, encode your result,
  including **layered encoding** for older clients.
- **Server-push routing** — deliver an update to whichever node holds the user.

You bring three things: an **`MTProtoConfig`**, a **`.tl` schema** (your methods),
and the **handlers**.

## The building blocks you write

### Server

`createServer<RpcMethods>(config)` returns the app. Its surface is small:

```ts
const app = createServer<RpcMethods>(config)
app.method(name, opts?, handler)      // register one route
app.register(plugin, deps)            // run a plugin (group of routes)
await app.listen()                    // open the carriers
app.inject(req)                       // dispatch a request with no socket (tests)
app.methods                           // the registered method names
await app.close()                     // drain + shut down
```

`RpcMethods` is generated from your schema (`yarn gen:types`); passing it makes
every route type-checked — the method name, its `params`, and its `result`.

### Method (route)

One TL method → one handler. `auth` defaults to `true`.

```ts
app.method('account.getAccountTTL', async (params, ctx) => {
    return { _: 'accountDaysTTL', days: 365 } // checked against the result type
})
```

### Plugin

A plugin is a function that registers routes — your unit of modularity, like
`fastify.register`. Dependencies are explicit (the second argument), and the body
runs **synchronously at registration time, before `listen()`**:

```ts
export const walletsPlugin = definePlugin<{ wallets: WalletService }>((app, { wallets }) => {
    app.method('wallets.getBalance', async (_p, ctx) => wallets.balanceOf(ctx.subject!))
})

app.register(walletsPlugin, { wallets: new WalletService(/* … */) })
```

### Handler context (`ctx`)

`ctx` carries request-scoped and cross-cutting concerns — never your services (a
handler closes over those). The full surface:

| `ctx` member                                   | What it is                                                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.subject`                                  | the bound subject — your internal user id (string), or `undefined` (anonymous). Not the wire `user_id` — see [sessions & auth](sessions-auth.md#subject-your-internal-user-id-not-the-wire-user_id) |
| `ctx.layer`                                    | the client's negotiated TL layer (read-only)                                                                                                                                                        |
| `ctx.login(subject)` / `logout()` / `revoke()` | session effects — see [sessions & auth](sessions-auth.md)                                                                                                                                           |
| `ctx.push(subject, update)`                    | server-push a TL update                                                                                                                                                                             |
| `ctx.set(key, val)` / `ctx.get<T>(key)`        | per-request value bag (pre-handler → handler)                                                                                                                                                       |
| `ctx.request`                                  | the raw `RpcContext` the gateway forwarded                                                                                                                                                          |

### Forwarder

The seam between the protocol engine and your methods. The framework is
in-process: the dispatcher hands a decoded method straight to your registry — no
broker, no network. You never name it; `createServer(...).listen()` wires it for
you. (Internals: [architecture](../internals/architecture.md).)

## The request lifecycle

What happens to one client call, end to end:

1. **Carrier** receives bytes (WS frame or TCP packet) and de-frames them.
2. **Crypto** decrypts with the session's auth key and verifies `msg_key`.
3. **Session** validates the `msg_id` (replay / ordering windows) and handles any
   service messages itself.
4. **TL codec** decodes the payload to a tagged object `{ _: 'method.name', … }`.
5. **Dispatcher** classifies it: a _service_ message is answered by the engine; a
   _business_ method is handed to the **forwarder**.
6. **Forwarder → `dispatchRpc`** looks the method up in your `RpcRegistry`:
    - unknown method → `404 METHOD_NOT_FOUND`;
    - `auth` required but the key is anonymous → `401 AUTH_KEY_UNREGISTERED`;
    - otherwise it runs your **pre-handlers**, then your **handler**.
7. The handler returns a result (or throws an `AppError`). Any session **effects**
   (`login`/`logout`/`revoke`) collected on `ctx` ride back alongside it.
8. **Gateway** applies the effects (e.g. binds `subject` to the auth key), encodes
   the result at the client's layer, and pushes it back down the carrier.

Steps 1–5 and 8 are the framework. Steps 6–7 are your code.

## Configuration in one place

The framework reads **no** environment — you build an `MTProtoConfig` and pass it
in (`createServer(config)`). Reading env is your app's job (its composition root).
The shape:

```ts
interface MTProtoConfig {
    nodeId: string // stable id per instance (presence routing)
    wsPort?: number // WebSocket carrier (omit to disable)
    tcpPort?: number // raw-TCP carrier (omit to disable)
    defaultLayer: number // TL layer until a client negotiates one
    schemaDir: string // YOUR business .tl
    schemaLayersDir: string // per-layer snapshots (scheme_N.json)
    rsaKeyPath?: string // production PEM (clients pin its fingerprint)
    disableMsgKeyCheck?: boolean // ⚠️ insecure interop shim — keep false
    storage: { backend: 'memory' | 'mongo'; mongoUrl?: string; mongoDb?: string }
    updates: {
        // server-push (off unless enabled)
        enabled: boolean
        redisUrl?: string // cross-instance presence + pub/sub bus
        presenceTtlMs: number
    }
}
```

## Where to go next

- **[Defining methods](adding-methods.md)** — routes, hooks, errors, server-push,
  app structure, testing.
- **[Sessions & auth](sessions-auth.md)** — the login flow, `auth`, session effects.
- **[The demo app](the-demo-app.md)** — a complete app to copy.
- **[Releasing a version](releasing-a-version.md)** · **[Deployment](deployment.md)**.
