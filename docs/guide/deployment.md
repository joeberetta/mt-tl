# Deployment

The model is **in-process**: the MTProto server (gateway + your handlers) runs in
ONE process. There is no broker between the gateway and your methods. You deploy
ONE thing — your app's `serve` entrypoint — and scale by running more **replicas**
behind a load balancer. Shared state (auth keys, sessions, salts, presence) lives
in Mongo + Redis, so any replica serves any client.

```bash
yarn workspace demo-eos-seed-app run serve   # createServer(config).register(app).listen()
```

Server-push to clients — from a handler via `ctx.push`, or from another process
via `createUpdatePublisher` — goes over a shared **Redis** bus (pub/sub) + Redis
presence. The app builds its `MTProtoConfig` from env (see its `.env.example`).

---

## Prerequisites

| Need                            | When                                                              |
| ------------------------------- | ----------------------------------------------------------------- |
| Node 20+, Yarn 4 (via corepack) | always                                                            |
| RSA private key (PEM)           | real clients (they pin its fingerprint — see below)               |
| MongoDB                         | more than one replica, or to persist auth keys / sessions / salts |
| Redis                           | server-push across replicas (presence + update bus)               |

Plus whatever **your app** needs (the demo, for instance, needs `CHAT_SERVER_SEED`).
With none of the above (memory storage, updates off) the server runs for local
smoke tests.

---

## Local development (Docker infra + app on the host)

Bring up Mongo + Redis in Docker, run the app with `tsx` on the host. The infra
compose, `Dockerfile`, and `.env.example` live in the app
(`examples/demo-eos-seed-app/`) — it's a self-contained consumer project.

```bash
yarn install                                    # from the repo root (workspaces)
cd examples/demo-eos-seed-app
docker compose up -d                            # mongo:27017, redis:6380
cp .env.example .env                            # set the app's required env
yarn serve                                      # createServer(config).register(app).listen()
```

A real mobile client needs the **production RSA PEM** (its fingerprint must match
what clients pin); set `RSA_PRIVATE_KEY_PATH`. Without it the server generates an
ephemeral key (handshake works only for test clients). Point the client at
`MTPROTO_WS_PORT` (8081) or `MTPROTO_TCP_PORT` (8082) and watch the
`rpc method=… status=…` log lines as it boots.

---

## Containers (prod-like)

The app ships a `Dockerfile` + compose (it builds from the monorepo root — the
compose sets that context):

```bash
cd examples/demo-eos-seed-app
docker compose -f docker-compose.yml -f docker-compose.apps.yml up -d --build
# scale out (state shared in Mongo/Redis):
docker compose -f docker-compose.yml -f docker-compose.apps.yml up -d --scale app=4
```

Inside the compose network the app reaches infra by **service name on internal
ports** (`mongo:27017`, `redis:6379`). Mount the production PEM into the `app`
service and set `RSA_PRIVATE_KEY_PATH` (see the commented lines in
`docker-compose.apps.yml`).

---

## Scaling (a uniform replica fleet)

Replicas are uniform: all shared state is in Mongo/Redis, so **any replica serves
any client at any layer** (a client's layer is negotiated inside the encrypted
stream — no per-layer routing at the edge). Scale by adding replicas behind a
load balancer.

```
           ┌────────── clients (WS / raw TCP) ──────────┐
           ▼                                            ▼
     ┌───────────┐   ┌───────────┐   ...   ┌───────────┐
     │  app #1   │   │  app #2   │         │  app #N   │   (one NODE_ID per replica)
     └─────┬─────┘   └─────┬─────┘         └─────┬─────┘
           │   Mongo (auth keys / sessions / salts)        ← durable shared state
           └───────────────┴── Redis (presence + update pub/sub) ──┘
```

### What to set for a fleet

| Concern   | Requirement                                                                 |
| --------- | --------------------------------------------------------------------------- |
| `NODE_ID` | unique & stable per replica (presence routing key). Use the pod/hostname.   |
| Storage   | `STORAGE_BACKEND=mongo` (shared) — never `memory` across replicas.          |
| RSA key   | the **same** production PEM on every replica (clients pin its fingerprint). |
| Schema    | identical `schema/` + `schema/layers/` on every replica.                    |
| Updates   | `UPDATES_ENABLED=true` + a shared `REDIS_URL` across all replicas.          |

Server-push: a replica publishes an update onto the Redis bus; the replica(s)
holding that user (per Redis presence) deliver it, rendered for each client's
layer. Live push is best-effort — loss is fine, since catch-up is your app's
`getDifference` (see [adding methods](adding-methods.md)).

### Collections `@mt-tl/server` creates (Mongo)

With `storage.backend: 'mongo'`, the server uses **three** collections in your
`MONGO_DB`, created lazily with the indexes below. If your app shares the same
database, steer clear of these names to avoid collisions:

| Collection    | Holds                                                            | Secondary indexes                                    |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `authKeys`    | auth keys, the bound `subject`, device/app meta, blocked flag    | `subject`, `isBlocked`, `createdAt`                  |
| `serverSalts` | per-auth-key rotating server-salt schedule                       | `{authKeyId, validSince}`, `{authKeyId, validUntil}` |
| `sessions`    | live sessions (auth key, subject, layer, last activity)          | `authKeyId`, `subject`, `lastActivity`               |

Presence + the update bus live in **Redis** (when `updates.redisUrl` is set), not
Mongo. The server creates **no** other collections — there is no engine-owned
update/pts log; durable update state is your app's, in collections you own.

### Graceful shutdown / draining

- On `SIGINT`/`SIGTERM` the server stops accepting connections and closes carriers,
  storage, and the update bus. In-flight per-connection work drains via the
  per-connection queue.
- Presence entries for a drained replica expire by TTL; updates stop routing to it.
  Clients reconnect to another replica and resync via your app's `getDifference`.

### Behind a proxy (nginx / HAProxy)

Set `trustProxy: true` (env `TRUST_PROXY=true`) so the server reads the real client
address from the proxy instead of the proxy's own IP. It surfaces as `ctx.request.ip`.

- WebSocket: the server reads the first `X-Forwarded-For` entry. Forward the
  `Upgrade`/`Connection` headers and set `X-Forwarded-For` at the proxy.
- Raw TCP: enable the **PROXY protocol** (v1 or v2) on the upstream proxy/LB; the
  server parses the prepended header and recovers the source IP.

Leave `trustProxy` **off** when clients connect directly — both `X-Forwarded-For`
and a PROXY header are spoofable by a client that reaches the server unfronted.

---

## Failure modes (by design)

- **Redis down** → live updates are dropped; clients recover via your app's
  `getDifference` on reconnect. Live push is best-effort, never the source of truth.
- **Redis presence stale** (crashed replica) → entries expire by TTL; delivery to a
  dead replica simply finds no socket.
- **Restart with `memory` storage** → all auth keys/sessions lost (clients
  re-handshake). Use `mongo` to avoid this.

---

## Operational checklist

- [ ] Same production RSA PEM on every replica; verify the advertised fingerprint
      matches what clients pin.
- [ ] `STORAGE_BACKEND=mongo` with a shared cluster for more than one replica.
- [ ] Unique `NODE_ID` per replica.
- [ ] Identical `schema/` + `schema/layers/` across all replicas.
- [ ] `UPDATES_ENABLED=true` + a shared `REDIS_URL` when server-push is on.
