# Introduction

By the end of these docs you'll have a **production-ready MTProto backend** running
behind a load balancer — a messaging-class app that real Telegram-style clients can
connect to, log into, and call. You'll write only your business logic; everything
about the protocol is handled for you.

## What is MTProto — and why it's hard without help

MTProto is the binary, encrypted protocol Telegram clients speak. It isn't REST: a
client opens a long-lived socket, performs an RSA + Diffie–Hellman handshake to
derive an **auth key**, and from then on every message is AES-IGE-encrypted,
integrity-checked (`msg_key`), sequenced, and serialized in **TL** — Telegram's
typed binary format. Clients also negotiate a **layer**, a schema version, so an old
app and a new app can both talk to the same server.

Implementing all of that yourself is brutal and easy to get subtly wrong. **mt-tl
owns it for you** — transport, handshake, crypto, sessions, salts, service messages,
TL (de)serialization, per-layer encoding, and server-push all live inside the
framework. You never touch a byte of it.

## The promise: you write methods

You build an MTProto server the way you'd build a [Fastify](https://fastify.dev/)
app — create a server, register routes, listen:

```ts
import { createServer } from '@mt-tl/server'
import type { RpcMethods } from './generated/schema.js'

const app = createServer<RpcMethods>(config)

app.method('messages.sendMessage', async (params, ctx) => {
    const msg = await messages.send(ctx.subject!, params)
    return msg // typed against your .tl schema
})

await app.listen() // WebSocket + raw-TCP carriers are open
```

A real client connects, handshakes, logs in, and calls your methods — and all you
wrote was the handler. You bring three things: a **config**, a **`.tl` schema** (your
methods), and the **handlers**.

## The three packages

| Package              | What it's for                                                | When you reach for it                    |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| **`@mt-tl/server`**  | the server — `createServer`, routes, hooks, server-push      | always — this is what you install        |
| **`@mt-tl/tl`**      | generates TypeScript types from your `.tl`, freezes layers   | at build time (`gen:types`, `freeze`)    |
| **`@mt-tl/testing`** | e2e tests with a real handshaking client + YAML scenarios    | when you want full-stack tests           |

The next page, **[the packages](guide/packages.md)**, breaks each one down.

## How to read these docs

These pages are a single path, beginner to production. Read them in order the first
time:

1. **Understand** — [the packages](guide/packages.md) and
   [how a request flows](guide/core-concepts.md) through the framework.
2. **Build** — [your first server](guide/getting-started.md), then
   [methods](guide/adding-methods.md), [auth](guide/sessions-auth.md),
   [server-push](guide/server-push.md), and [tests](guide/testing.md).
3. **Ship & operate** — [schema layers](guide/releasing-a-version.md),
   [deployment & scaling](guide/deployment.md), the
   [system-design picture](guide/system-design.mdx),
   [observability](guide/observability.md), and the
   [go-live checklist](guide/production-checklist.md).
4. **Reference** — the [FAQ](guide/faq.md), the full [configuration](guide/configuration.md),
   and the [demo app](guide/the-demo-app.md) to copy.

You won't need to understand the handshake, crypto, or sessions to build — that's
the whole point. Curious anyway? **Under the hood**
([architecture](internals/architecture.md),
[protocol compliance](internals/protocol-compliance.md)) is there when you want it.

---

**Next:** [the packages →](guide/packages.md)
