# mt-tl docs

Two audiences, two trees.

## 📦 Using the framework — [`guide/`](guide/getting-started.md)

You installed `@mt-tl/server` and you're building an app. You don't need to know
how the protocol works inside. Read it top to bottom, or jump to a topic.

**Start here**

1. **[getting-started.md](guide/getting-started.md)** — the 5-minute start:
   `createServer` → route → `listen`.
2. **[core-concepts.md](guide/core-concepts.md)** — the mental model: server,
   plugins, methods, the request lifecycle.

**Building your app**

3. **[adding-methods.md](guide/adding-methods.md)** — defining methods: routes,
   hooks (pre-handlers), errors, server-push, app structure, testing.
4. **[sessions-auth.md](guide/sessions-auth.md)** — the login flow, the `auth`
   gate, session effects (`login` / `logout` / `revoke`).
5. **[the-demo-app.md](guide/the-demo-app.md)** — a complete app to copy.

**Shipping it**

6. **[releasing-a-version.md](guide/releasing-a-version.md)** — evolve the schema,
   freeze a TL layer, migrations, roll out a build.
7. **[deployment.md](guide/deployment.md)** — scaling by replicas, server-push
   infra, prod.
8. **[observability.md](guide/observability.md)** — the structured logger: levels,
   pretty/JSON, error stacks, `ctx.log`, what the engine logs.

The runnable reference app is [`examples/demo-eos-seed-app`](https://github.com/joeberetta/mt-tl/tree/master/examples/demo-eos-seed-app) —
copy it.

## 🔧 Maintaining the framework — [`internals/`](internals/architecture.md)

You're developing the MTProto gateway itself.

- **[architecture.md](internals/architecture.md)** — how the gateway works inside:
  the cut line, request lifecycle, crypto, sessions, server-push, layered encode.
- **[protocol-compliance.md](internals/protocol-compliance.md)** — status vs. the
  Telegram spec and the known simplifications (salts/`get_future_salts`, service
  messages). The audit surface for compliance work.
- **[msgkey-v1-quirk.md](internals/msgkey-v1-quirk.md)** — a real-client MTProto v1
  `msg_key` deviation and the `disableMsgKeyCheck` interop shim.
