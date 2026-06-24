# Server-push (updates)

Most of an MTProto app isn't request/response — it's the server pushing **updates**
to clients: a new message, a presence change, a profile edit. You push to a
**subject** (your internal user id) and the framework delivers it, encrypted, to
whichever connections that user has open, each rendered at its own layer.

## From a handler — `ctx.push`

Inside a handler you have `ctx`, so push directly. Delivery is decoupled from where it
originates: you hand the update to the bus and whichever node holds that subject
delivers it.

```ts
app.method('messages.sendMessage', async (params, ctx) => {
    const msg = await messages.send(params, ctx.subject!)
    // The recipient arrives as a PUBLIC id on the wire — translate to its subject
    // before pushing (the push path is keyed by your internal id, never the wire id).
    const peer = await users.byId(params.peerUserId)
    if (peer) ctx.push(peer.subject, { _: 'updateNewMessage', message: msg })
    return msg
})
```

That `byId → subject` translation is the same edge mapping covered in
[sessions & auth](sessions-auth.md#subject-your-internal-user-id-not-the-wire-user_id):
the wire carries public ids; push is keyed by your internal id.

## From another process — `createUpdatePublisher`

Code outside the server — a webhook receiver, an event consumer, a cron — has no
`ctx`. Use a standalone publisher onto the same bus:

```ts
import { createUpdatePublisher } from '@mt-tl/server'

const updates = await createUpdatePublisher({ redisUrl: process.env.REDIS_URL })
await updates.push(subject, { _: 'updateNewMessage', message: { /* … */ } })
```

Which to use depends on **where your code is** (handler → `ctx.push`; another process
→ `createUpdatePublisher`), not on instance count. Cross-process push needs a
**shared bus** — set `REDIS_URL`; in-memory only works within one process. A client
that connected with `invokeWithoutUpdates` is excluded from push automatically.

## How delivery is routed

You never address a node — you address a subject. Each replica writes its connected
users into Redis **presence** (`presence:{subject} → nodeId`, TTL-refreshed); a push
is routed only to the node(s) actually holding that user, then rendered per connection
at each client's layer. No broadcast fan-out. The full picture, including the
fall-through when a layer can't represent an update, is in
[system design at scale](system-design.mdx) and [deployment](deployment.md).

## Pushing to anonymous connections (by auth key)

`ctx.push` / `createUpdatePublisher().push` target a **subject** — a logged-in user.
To reach a specific connection that isn't logged in yet (e.g. delivering something
mid-registration), push by its **auth key** instead:

```ts
ctx.pushToAuthKey(ctx.request.authKeyId, { _: 'someUpdate' /* … */ })
// or cross-process: updates.pushToAuthKey(authKeyId, update)
```

Auth-key pushes are **live-only** — they reach that one connection if it's online, and
nothing more.

## Catch-up: live push is best-effort

The framework delivers updates **live and best-effort** — it keeps no durable update
state, so a client that was offline simply misses the push. That's by design: losing a
live update is fine because clients **resync** on reconnect. If your app needs
catch-up, **your app owns it**:

- implement `updates.getState` / `updates.getDifference` as **normal methods**;
- persist the updates you care about, with an incrementing `pts`;
- embed that `pts` in what you push.

Only your app knows which entities a client must resync (messages, chats, users, …),
so it's the only place that can answer `getDifference` correctly. The framework
guarantees ordering and live delivery; durability is your worker's job. (This split is
why a Redis outage only drops _live_ pushes — clients recover via `getDifference`. See
the [FAQ](faq.md#realtime).)

---

**Next:** [testing →](testing.md)
