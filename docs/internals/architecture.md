# Architecture & how it works

`mt-tl` is an MTProto 2.0 **gateway**. It terminates the MTProto protocol
(transport, framing, auth-key exchange, sessions, salts, service messages, and
TL binary (de)serialization) and forwards every **business TL method** to a
backend as **JSON-RPC 2.0**, serializing the response back to TL. It also pushes
backend-originated **updates** to connected clients.

The gateway owns no business logic. Swapping the auth scheme, adding methods, or
changing update semantics happens in the consumer app, not here.

> This doc is the **internal** view, for contributing to the framework. To _use_
> the framework, start with [getting-started.md](../guide/getting-started.md) and
> [development.md](../guide/adding-methods.md).

---

## Monorepo map

Two published packages; the consumer app is the third workspace.

```
packages/
  server/        @mt-tl/server — the whole MTProto server: createServer, routes,
                 plugins, hooks, ctx.push, createUpdatePublisher, AND the engine
                 (transport/crypto/session/dispatch/storage/updates) + handler layer
                 (registry/dispatch/hooks/context/errors) folded in.
  tl/            @mt-tl/tl — TL tooling: parser/IR, generic codec, value↔JSON,
                 wire, migrations, the type generator, + the MTProto PROTOCOL schema.
examples/
  demo-eos-seed-app/   the consumer app: owns its business .tl, generated types,
                       config (loadConfig), plugins, and the runnable entrypoint
```

A consumer installs just `@mt-tl/server` (+ `@mt-tl/tl` for codegen). The
package reads no environment and ships no runnable `main` — the app builds the
`MTProtoConfig` and owns the entrypoint (`createServer(config).register(app).listen()`
— in-process; scale by replicas).

## Engine internals (`packages/server/src/`)

The facade (`create-server.ts`, `update-publisher.ts`, `index.ts`) sits over two
internal layers — the handler layer (`core/`) and the protocol engine (the rest):

```
  core/        handler layer: rpc registry + dispatch + hooks, context, errors, updates
  tl/          schema loader → registry, generic codec, layered registry
               (per-layer encode), protocol type views, migration glue
  crypto/      aes-ige, hashes, dh (prime/modpow/makePQ), rsa, msg-key (v2)
  transport/   framing (abridged/intermediate/full/obfuscated), ws + tcp servers,
               connection (+ ctx), connection-registry (subject → conns)
  auth/        handshake state machine, nonce store
  session/     session manager, message-id generation, salts, inbound tracker
  storage/     pluggable: in-memory (default) | mongo (auth keys, salts, sessions)
  dispatch/    dispatcher (unwrap + service vs business), forwarders
               (in-process | print), wire envelope, effects
  updates/     presence (in-memory | redis), update bus (in-memory | redis pub/sub),
               update router, push service, per-layer render (updateUnsupported)
  server/      message pipeline (decrypt/encrypt orchestration)
  bootstrap.ts in-process wiring (bootstrap);  gateway.ts buildGateway;  lib.ts engine API
```

---

## Request lifecycle (client → backend → client)

```
WS/TCP bytes ─▶ Framing ─▶ MessagePipeline.handlePacket
   │ plaintext (auth_key_id == 0)            │ encrypted
   ▼                                         ▼
 Handshake state machine            decrypt (AES-IGE, MTProto 2.0, msg_key verified)
 req_pq → req_DH_params →             → { salt, sessionId, msgId, seqNo, payload }
 set_client_DH_params                 → ensureSession (new_session_created once)
   ▼                                  → bind presence if the key is authorized
 dh_gen_ok (auth key stored)               ▼
                                      Dispatcher.dispatchPayload
                                        ├─ gzip_packed → inflate → re-dispatch
                                        ├─ msg_container → fan out inner messages
                                        ├─ unwrap invokeWithLayer / initConnection /
                                        │   invokeWithoutUpdates / invokeAfterMsg
                                        ├─ service msg (ping, msgs_ack, …) → handled here
                                        └─ business method → RpcForwarder (JSON-RPC 2.0)
                                              → apply effects (bindUser, …)
                                              → result → rpc_result   | error → rpc_error
                                              ▼
                                      encrypt at the client's layer → Framing → bytes
```

Per-connection processing is serialized (`Connection.enqueue`) so messages are
handled in arrival order.

---

## Authorization

MTProto's auth key is transport-level and starts anonymous. User authorization
is a **business concern**: `crypto.sendCode/signIn/signUp` (or any scheme) are
ordinary methods forwarded to the backend.

The only auth state the gateway owns is the `subject` (the app's internal user id,
an opaque string) bound to an auth key — never the public `user_id` that rides in
TL payloads. The forwarder response therefore carries **session effects**:

```
RpcResponse = { result? | error?, effects?: SessionEffect[] }
SessionEffect = bindUser(subject) | unbindUser | revokeKey
```

`signIn` returns `auth.authorization` (with the public `user.id`) + `effects:
[bindUser('<uuid>')]`; the gateway calls `authKeys.bindUser` with the subject and
updates the session/connection. Auth key = device
login (MTProto semantics): all sessions on that key become authorized. The auth
scheme is fully swappable on the backend — the gateway never sees a seed phrase.

---

## TL schema and layers

- **Schema ownership:** `@mt-tl/tl` ships only the fixed MTProto **protocol**
  schema. The consumer app owns the full `.tl` (protocol + business) under its own
  `schema/`, and `config.schemaDir` points the gateway at it. The framework's
  protocol-only schema is the default when no app provides one.
- The `.tl` files are parsed at startup into an in-memory IR
  (`{id, predicate|method, params, type}`), CRC32-validated. A single generic
  codec serializes/deserializes arbitrary types as tagged objects
  `{ _: 'name', ...fields }`. The fixed MTProto protocol/handshake structs use
  hand-written decoding where the schema declares binary fields as `string`.
- **Decoding is layer-agnostic** — the wire constructor id is unambiguous.
- **Encoding is layer-aware.** Per-layer snapshots in `schema/layers/`
  (`scheme_N.json`) feed a `LayeredRegistry`; every message is encoded
  with the constructor id/fields valid for the client's negotiated layer (floored
  to the nearest available snapshot). Without snapshots, layered encoding is off
  and the merged schema is used.

### Freezing a layer

`schema/*.tl` is the single **working / newest** schema. `schema/layers/*.json`
are **frozen historical snapshots**, one per shipped layer — and the layer number
is taken from the filename (`scheme_205.json` → layer 205), not the file
contents. `DEFAULT_LAYER` is only the fallback layer for a connection that hasn't
sent `invokeWithLayer`; it is not "the schema version".

When you ship a layer, freeze the current `.tl` into a snapshot:

```bash
yarn freeze 205        # writes schema/layers/scheme_205.json from schema/*.tl
```

Then the `.tl` keeps evolving toward 206. **Always freeze the newest shipped
layer** — otherwise a type that changed in it would be encoded with a stale id
for clients on that layer. Snapshots must be identical across all gateway pods.

### Updates and layers

A pushed update is rendered **per connection** (multi-device clients on different
layers get different bytes):

- representable at the layer → sent as-is;
- not representable but **pts-bearing** → `updateUnsupported{pts, pts_count}`
  (preserves pts so the client resyncs via `getDifference`);
- not representable and ephemeral (no pts) → dropped.

The gateway does **structural** mapping (same predicate across layers), not
semantic translation between predicates — backward compatibility across feature
changes is the backend's job.

---

## Server push (updates)

Durability and live delivery are separate concerns:

- **Durable + pts** lives on the backend: the worker appends each update to the
  user's log with an incrementing pts; `updates.getDifference` is a normal
  forwarded method. The gateway knows nothing about pts storage.
- **Live push is best-effort.** Loss / drop-under-load is fine — the client
  recovers via a pts gap → `getDifference`.

```
Publisher ─publishUpdate─▶ updates.in ──▶ Update Router (sharded by subject)
(ctx.push /                               │ presence.lookup(subject)
 createUpdate-                            │ throttle/coalesce (anti-DDoS valve)
 Publisher)                               ▼
                              updates.node.{nodeId} ──▶ server node
                                                          │ registry.getBySubject
                                                          │ render per layer
                                                          ▼ encrypted notification
                                                        client
```

Presence (`presence:{subject} → {nodeId…}`, Redis) is written by gateways
(heartbeat-refreshed TTL) and read by the router, so an update reaches only the
nodes holding the user — no broadcast fan-out.

---

## Storage

`storage/` is pluggable behind one interface:

- `memory` (default) — no external services; auth keys/salts/sessions in-process.
- `mongo` — collections `authKeys`, `serverSalts`, `sessions` (bigints as strings,
  keys as Binary). Required for multi-instance (shared state).

---

## Forwarders (gateway → handlers)

The dispatcher hands a decoded business method to an `RpcForwarder`. In-process is
the only path:

- `InProcessForwarder` — calls the app's `dispatchRpc` directly (no broker). This
  is what `createServer(...).listen()` wires.
- `PrintForwarder` — the fallback when no app is wired: logs the request and
  returns `NOT_IMPLEMENTED`.

The request/response envelope is `{ id, method, params, context }` →
`{ result? | error?, effects? }` (a plain object — no JSON-RPC-over-network; the
historical HTTP/RabbitMQ split was removed when the framework went in-process).

---

## Wire-compatibility

Crypto and framing reproduce the legacy MTProto server byte-for-byte (DH prime,
AES-IGE, msg_key derivation, salt math, constructor ids), pinned by known-answer
tests captured from the old libs. Existing clients pin a server RSA key — set
`RSA_PRIVATE_KEY_PATH` to the production PEM so the advertised fingerprint matches.

One real-client quirk (MTProto v1 `msg_key` over a v2 session) and the
`disableMsgKeyCheck` interop shim are written up in
[mtproto-v1-msgkey-bug-report.md](msgkey-v1-quirk.md).
