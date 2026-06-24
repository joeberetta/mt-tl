# Production checklist

Everything to verify before you put real clients on a build. Each item links to the
page that explains it; this page is the single list you run down before going live.

## Identity & wire-compat

- [ ] **Same production RSA PEM on every replica.** Clients pin its fingerprint —
      point `rsaKeyPath` at the production PEM and confirm the advertised fingerprint
      matches what clients expect. ([configuration](configuration.md#the-rsa-key-wire-compat))
- [ ] **`disableMsgKeyCheck` / `disableSeqNoCheck` are `false`.** These are insecure
      interop shims, never on in prod. ([configuration](configuration.md#escape-hatches-secure-by-default))

## State (shared, durable)

- [ ] **`storage.backend: 'mongo'`** with a shared cluster for more than one replica —
      never `memory` across replicas, or clients re-handshake on every reconnect.
      ([configuration](configuration.md#storage))
- [ ] **Unique, stable `nodeId` per replica** (the presence routing key — use the
      pod/hostname).
- [ ] Your app's own collections **don't collide** with the engine's `authKeys`,
      `serverSalts`, `sessions`. ([deployment](deployment.md#collections-mt-tlserver-creates-mongo))

## Schema & layers

- [ ] **Identical `schema/` + `schema/layers/` on every replica.**
- [ ] The **newest shipped layer is frozen**, and every non-additive change has a
      migration ladder. ([schema versions & layers](releasing-a-version.md))

## Server-push

- [ ] **`updates.enabled: true` + a shared `redisUrl`** across all replicas if you push.
      ([configuration](configuration.md#updates-server-push))
- [ ] Catch-up is implemented in **your app** (`getState` / `getDifference` + a `pts`
      log) — live push is best-effort. ([server-push](server-push.md#catch-up-live-push-is-best-effort))

## Edge & networking

- [ ] Behind nginx/HAProxy: **`trustProxy: true`**, with `X-Forwarded-For` (WS) /
      PROXY protocol (raw TCP) configured upstream. Leave it off if clients connect
      directly. ([deployment](deployment.md#behind-a-proxy-nginx--haproxy))
- [ ] Load balancer fans connections across replicas — no per-layer routing needed.
      ([system design](system-design.mdx))

## Observability

- [ ] **`LOG_FORMAT=json`** in prod, shipped to your log pipeline; `LOG_LEVEL=info`
      (not `debug`/`trace` — those log full payloads). ([observability](observability.md))
- [ ] `LOG_ERROR_STACK=true` if you want stacks on error lines in prod.

## Lifecycle

- [ ] **Graceful drain on SIGTERM/SIGINT** is wired (the server stops accepting, closes
      carriers, drains in-flight work). Rolling restarts are safe because state is
      shared. ([deployment](deployment.md#graceful-shutdown--draining))

## Before you ship

- [ ] A **full-stack test** (real client → engine → handlers) passes — at least the
      login flow and one push. ([testing](testing.md))
- [ ] A YAML scenario suite runs in **CI** as a gate (`mtproto-test run ./scenarios`).

---

**Next:** [FAQ →](faq.md)
