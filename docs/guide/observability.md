# Observability (logging)

`@mt-tl/server` ships one small structured logger, used by the protocol engine,
the handler layer, and (recommended) your own app code — so every line shares a
format and you can ship them all to one pipeline. No `console.log` anywhere.

```ts
import { createLogger } from '@mt-tl/server'

const log = createLogger({ name: 'node-1' })
log.info('hello', { wsPort: 8081 })
```

## Levels

Six levels, most to least verbose: `trace` < `debug` < `info` < `warn` < `error`
< `silent`. Set the threshold with `LOG_LEVEL` (default `info`; `silent` under
tests). Everything at or above the threshold is emitted.

| Level   | What the engine logs                                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trace` | Byte/hex protocol firehose: every WS recv, framing headers, decrypt (`ws.recv`, `framing.*`, `enc.ok`).                                                          |
| `debug` | Useful protocol events + **full payloads**: request in (`rpc.params`), response out (`rpc.result`), update out (`update.data`); plus `salt.bad`, `msg.rejected`. |
| `info`  | One request/response line + lifecycle links/unlinks + update deliveries (see below).                                                                             |
| `warn`  | Recoverable anomalies: `decode.fail`, `rpc.unknown`, `enc.msgkey.reject`, `framing.error`, insecure config.                                                      |
| `error` | A request that crashed (`rpc.fail` / `handler.fail`) or an update that couldn't be delivered (`update.fail`).                                                    |

### What you get at `info` (the default)

- **Requests** — `rpc { reqId, method, subject, authKeyId, sessionId, layer, ms, status }`
  (one line per RPC, ok or business error). `reqId` is the client's `msg_id` — it
  ties the request to its handler logs. `deviceModel` and `ip` are added once known
  (device after `initConnection`).
- **Sockets** — `conn.open { remote }` / `conn.close { code }` (WS and raw-TCP).
- **Auth keys** — `authkey.create` (handshake completed, new key persisted),
  `authkey.revoke`.
- **Users** — `user.bind { subject }` (login) / `user.unbind` (logout).
- **Sessions** — `session.new { sessionId, subject }`.
- **Updates** — `update.push { subject|authKeyId, type, conns }` when delivered;
  `update.nodest` (no local connection — client recovers via pts) is `debug`.

### Tracing payloads — what came in / what went out (`debug`)

The `info` `rpc` line is a summary (no payload). At `debug` the engine also logs the
**full data** of every request, response, and update, each carrying the same
`reqId` so you can pair them:

- `rpc.params { reqId, …, params }` — the decoded request as it arrived.
- `rpc.result { reqId, …, result }` — the result sent back (success path).
- `update.data { subject|authKeyId, type, update }` — an update being pushed out.

Payloads are **not truncated** (that's the point of `debug`) — it's noisy and may
contain sensitive fields, so keep it to dev / a single session, not prod.

## Formats: pretty vs JSON

`LOG_FORMAT=json` emits one JSON object per line (ship it to Loki/ELK/Datadog);
anything else is a readable line for local dev. The pretty line is **ANSI-colored
when stdout is a TTY** (colored level, dimmed keys so fields don't blur together);
piping to a file drops color automatically. Honors `NO_COLOR` (force off) and
`FORCE_COLOR` (force on); or set `createLogger({ color })` explicitly.

```
# pretty (dev)
06:05:52.412 INFO  [node-1] rpc method=help.getConfig subject=u_42 layer=204 ms=12 status=ok

# json (prod)  — LOG_FORMAT=json
{"time":"2026-06-14T06:05:52.412Z","level":"info","name":"node-1","msg":"rpc","method":"help.getConfig","subject":"u_42","layer":204,"ms":12,"status":"ok"}
```

## Error stacks (opt-in for prod)

On `error` lines, an `Error` field serializes to `{ name, message }` — and the
**stack** only when you ask for it. Default: on for `pretty` (dev), off for `json`
(prod opts in). Override with `LOG_ERROR_STACK=true|false`.

```bash
LOG_FORMAT=json LOG_ERROR_STACK=true node …   # prod with stacks
```

A handler that throws an unexpected error is logged as `handler.fail` with the
error (stack-gated) so the failed request is traceable; the client still only sees
a generic `500 INTERNAL`. A thrown `AppError` (an expected business rejection) is
`debug`, not `error`.

## In your handlers: `ctx.log`

Each request gets a child logger pre-bound with `{ reqId, method, subject,
authKeyId, sessionId }`, so your lines carry the full request identity and join
the engine's `rpc` line (same `reqId`) for that request:

```ts
app.method('messages.send', async (params, ctx) => {
    ctx.log.debug('sending', { to: params.peer })
    const res = await messages.send(ctx.subject!, params)
    return res
})
```

The server's root logger is also exposed as `app.log` (for boot/shutdown lines and
anything outside a request).

## Configuring it

`createServer` builds a logger from the environment by default. To control level,
format, or stacks explicitly — or to reuse the **same** instance in your own code —
build one and pass it in:

```ts
import { createServer, createLogger } from '@mt-tl/server'

const log = createLogger({ name: config.nodeId }) // reads LOG_LEVEL / LOG_FORMAT
const app = createServer(config, { logger: log })

// …elsewhere in your app, same style/sink:
log.child({ scope: 'billing' }).info('charge.ok', { subject, amount })
```

`createLogger(options)` accepts `{ level, format, name, bindings, errorStack,
write }`. `child(bindings)` returns a logger that merges fields into every line
(the engine uses `{ scope, conn }`); `isLevelEnabled(level)` lets you guard
expensive field building (hex dumps, big JSON).

## Turning on the protocol firehose

To debug a client at the wire level, set `LOG_LEVEL=trace`. This adds every
recv, framing detection, and decrypt — very noisy; use it for a single session,
not in prod.

## Cheat sheet

| Env var           | Default            | Effect                             |
| ----------------- | ------------------ | ---------------------------------- |
| `LOG_LEVEL`       | `info`             | Threshold (`trace`…`silent`).      |
| `LOG_FORMAT`      | `pretty`           | `json` for machine-readable lines. |
| `LOG_ERROR_STACK` | pretty:on json:off | Force `Error.stack` on/off.        |
| `NO_COLOR`        | unset              | Set (any value) to disable color.  |
| `FORCE_COLOR`     | unset              | Set to force color (non-TTY).      |

---

**Next:** [production checklist →](production-checklist.md)
