# Configuration

Every knob in one place. The framework reads **no environment** — you build an
`MTProtoConfig` and pass it to `createServer(config)`. Reading env and assembling the
config is your app's job (its composition root), which keeps the framework testable
and your config explicit.

## `MTProtoConfig`

```ts
interface MTProtoConfig {
    nodeId: string // stable id per instance (presence routing key)
    wsPort?: number // WebSocket carrier (omit to disable)
    tcpPort?: number // raw-TCP carrier (omit to disable)
    defaultLayer: number // TL layer until a client announces one
    schemaDir: string // YOUR business .tl
    schemaLayersDir: string // per-layer snapshots (scheme_N.json)
    schemaLayerPrefix?: string // snapshot filename prefix (default "scheme_")
    protocolSchemaDir?: string // override the bundled MTProto protocol (overlay)
    rsaKeyPath?: string // production PEM (clients pin its fingerprint)
    trustProxy?: boolean // read the real client IP from a fronting proxy
    disableMsgKeyCheck?: boolean // ⚠️ insecure interop shim — keep false
    disableSeqNoCheck?: boolean // interop shim for non-spec seqno — keep false
    storage: { backend: 'memory' | 'mongo'; mongoUrl?: string; mongoDb?: string }
    updates: {
        enabled: boolean // server-push (off unless enabled)
        redisUrl?: string // cross-instance presence + pub/sub bus
        presenceTtlMs: number
    }
}
```

| Field               | What it does                                                                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nodeId`            | Unique, stable id per replica — the presence routing key for server-push. Use the pod/hostname. **Must differ per replica.**                                                                                                                         |
| `wsPort`            | WebSocket carrier port. Omit to disable WS.                                                                                                                                                                                                          |
| `tcpPort`           | Raw-TCP (MTProto over TCP) carrier port. Omit to disable raw TCP.                                                                                                                                                                                    |
| `defaultLayer`      | The TL layer used for a connection until it sends `invokeWithLayer`. A fallback, **not** "the schema version".                                                                                                                                       |
| `schemaDir`         | Path to your business `.tl`. The MTProto protocol schema is bundled — you don't list it.                                                                                                                                                             |
| `schemaLayersDir`   | Path to frozen per-layer snapshots (`scheme_N.json`). See [schema versions & layers](releasing-a-version.md).                                                                                                                                        |
| `schemaLayerPrefix` | Filename prefix of the snapshots in `schemaLayersDir`. Default `scheme_`. Set it only if you froze with a custom `--prefix` (e.g. `layer_`).                                                                                                         |
| `protocolSchemaDir` | Override the bundled MTProto protocol schema (dir or `.tl`). Its defs **win** name/id clashes (overlay), so declare only what you change — e.g. an `initConnection` with extra fields. See [extending the protocol](#extending-the-protocol-schema). |
| `rsaKeyPath`        | Path to the production RSA private key (PEM). Real clients pin its fingerprint — see below. Omit and the server generates an ephemeral key (test clients only).                                                                                      |
| `trustProxy`        | When behind nginx/HAProxy, read the real client IP (`X-Forwarded-For` for WS, PROXY protocol for TCP) instead of the proxy's. See [deployment](deployment.md#behind-a-proxy-nginx--haproxy).                                                         |
| `storage`           | Where auth keys / sessions / salts live — see below.                                                                                                                                                                                                 |
| `updates`           | Server-push — see below.                                                                                                                                                                                                                             |

### Storage

```ts
storage: { backend: 'memory' }                                  // dev only
storage: { backend: 'mongo', mongoUrl: '…', mongoDb: 'myapp' }  // anything real
```

- **`memory`** (default-friendly) — no external services; auth keys/salts/sessions in
  the process. Lost on restart, not shared. **Single instance only.**
- **`mongo`** — durable + shared. **Required for more than one replica** (any replica
  serves any client). The server creates three collections — `authKeys`,
  `serverSalts`, `sessions` — in `mongoDb`; steer your app's own collections clear of
  those names. Details in [deployment](deployment.md#collections-mt-tlserver-creates-mongo).

### Updates (server-push)

```ts
updates: { enabled: false, presenceTtlMs: 60_000 }                       // push off
updates: { enabled: true, redisUrl: process.env.REDIS_URL, presenceTtlMs: 60_000 } // on, cross-instance
```

- `enabled` — turn server-push on. Off, `ctx.push` is a no-op.
- `redisUrl` — the shared bus + presence store. **Required for cross-instance push**
  (and for `createUpdatePublisher` from another process). In-memory works within a
  single process only.
- `presenceTtlMs` — how long a replica's presence entry lives without a heartbeat; a
  drained/crashed node's entries expire and stop receiving pushes.

See [server-push](server-push.md) for the API.

## `createServer` options (second argument)

Beyond the config, `createServer(config, options?)` accepts:

```ts
import { createServer, createLogger } from '@mt-tl/server'

const app = createServer(config, {
    logger, // a createLogger(...) instance (else one is built from env)
    migrations, // a MigrationRegistry for breaking schema changes
    onInitConnection, // audit/validate the client's initConnection (throw to reject)
})
```

- `logger` — pass your own so the engine and your app share one format/sink. See
  [observability](observability.md). Omit it and `createServer` builds one from the
  environment.
- `migrations` — a `MigrationRegistry`, applied around every handler. See
  [schema versions & layers](releasing-a-version.md#migration-ladders).
- `onInitConnection(body, info)` — called when a client sends `initConnection`, with
  its full decoded body (including any custom fields you added by overriding the
  protocol schema) and `{ authKeyId, sessionId, ip, apiLayer }`. Runs **before** the
  framework persists anything, so **throw** to reject the connection — nothing is
  written and the client gets an `rpc_error`. See [extending the protocol](#extending-the-protocol-schema).

## Extending the protocol schema

The MTProto protocol layer (handshake, service messages, `initConnection`,
`invokeWithLayer`, …) is bundled in `@mt-tl/tl`. To **add fields** to a protocol
type — e.g. push a couple of custom fields through `initConnection` — point
`protocolSchemaDir` at a `.tl` that redeclares just that type:

```ts
// protocol/initConnection.tl  — overlay: only what you change
//   initConnection#a1b2c3d4 {X:Type} flags:# api_id:int device_model:string
//     system_version:string app_version:string system_lang_code:string
//     lang_pack:string lang_code:string tenant_id:flags.2?string query:!X = X;
const app = createServer({ ...config, protocolSchemaDir: './protocol' })
```

Your override **wins** name/id clashes over the bundled protocol (the bundled one
still fills everything you didn't touch). The extra fields a client sends are:

- handed to handlers on `ctx.request.initParams` (tagged JSON; the standard ones —
  `apiId`, `deviceModel`, … — are also pre-extracted as typed fields), and
- **persisted** automatically to the auth key's meta (`AuthKeyMeta.initParams`) — no
  `onInitConnection` needed for storage; the hook is only for audit/validation, and
  to write into your **own** DB if you keep one.

Two caveats:

- Pass the **same** path to the studio (`mt-tl-studio build --protocol ./protocol`)
  so its playground speaks your protocol and its docs hide the low-level types.
- This works end-to-end for types the **client sends** (like `initConnection`). For
  messages the server **generates** (`rpc_error`, `pong`, …) an override changes the
  wire shape, but the engine won't populate new fields without a dedicated hook —
  not wired yet.

## Environment variables

The framework itself reads none. The two places env _is_ read:

- **Your app**, building `MTProtoConfig` (the names are yours; the demo uses
  `RSA_PRIVATE_KEY_PATH`, `MONGO_URL`, `REDIS_URL`, `NODE_ID`, `STORAGE_BACKEND`,
  `UPDATES_ENABLED`, `TRUST_PROXY`).
- **The default logger** `createServer` builds when you don't pass one:

| Env var                    | Default              | Effect                             |
| -------------------------- | -------------------- | ---------------------------------- |
| `LOG_LEVEL`                | `info`               | Threshold (`trace`…`silent`).      |
| `LOG_FORMAT`               | `pretty`             | `json` for machine-readable lines. |
| `LOG_ERROR_STACK`          | pretty:on / json:off | Force `Error.stack` on/off.        |
| `NO_COLOR` / `FORCE_COLOR` | unset                | Disable / force ANSI color.        |

Full logging guide: [observability](observability.md).

## The RSA key (wire-compat)

Existing clients pin a specific server RSA key — they refuse to handshake unless the
advertised fingerprint matches. Point `rsaKeyPath` at the **same production PEM on
every replica** so the fingerprint is stable. Without it the server generates an
ephemeral key each boot, which only test clients (that don't pin) accept.

## Escape hatches (secure by default)

Two checks are spec-compliant by default but can be disabled for a non-compliant
client — temporary shims, to be removed once the client conforms:

- **`disableMsgKeyCheck`** (env `DISABLE_MSG_KEY_CHECK`) — drops the inbound MTProto
  2.0 `msg_key` integrity check. ⚠️ **Insecure** — only for a known client that
  computes `msg_key` the old (1.0) way; keep `false` in production.
- **`disableSeqNoCheck`** (env `DISABLE_SEQNO_CHECK`) — turns off seqno validation for
  a client that doesn't set `seqno` to spec.

Both default to enforcing. See [protocol compliance](../internals/protocol-compliance.md)
for the rationale.

---

See also: [deployment & scaling](deployment.md) · [the production checklist](production-checklist.md).
