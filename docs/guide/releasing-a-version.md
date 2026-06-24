# Schema versions & layers

In MTProto a client's "version" is its **TL layer** — and that's what lets a
five-year-old app and yesterday's build talk to the same server. This page explains
what a layer is, then the schema lifecycle: edit, regenerate, freeze, migrate, ship.

## What a layer is

Your `.tl` schema is the contract: every type and method has a constructor id baked
from its definition. As you add fields and methods over time, that contract evolves.
A **layer** is a numbered, frozen snapshot of the contract at a point in time. When a
client connects it announces the layer it was built against (`invokeWithLayer(N)`),
and the server **encodes its replies using that layer's shape** — so an old client
keeps receiving bytes it can decode, even after you've moved on.

Two facts make this manageable:

- **Decoding is layer-agnostic.** The wire constructor id is unambiguous, so the
  server can always _read_ what any client sends.
- **Only encoding is layer-aware.** The server floors a client's announced layer to
  the nearest frozen snapshot and writes that layer's ids/fields.

So your job when shipping is: keep one working schema, and **freeze a snapshot each
time you ship a layer**. Your handlers always see the newest shape.

## 1. Edit the schema, regenerate types

Your app owns its `.tl` (in `schema/`). Add or change a constructor or method, then:

```bash
npx mt-tl gen-types ./schema ./src/generated/schema.ts
```

This regenerates the `RpcMethods` map + interfaces; your handlers get the new typed
`params`/`result` immediately. The `.tl` is always the **newest, in-progress** layer.

> Each line's CRC32 must match its declared `#id`; the parser validates this on load
> (warns on mismatch). Some vendored protocol constructors have benign historical
> mismatches — the codec uses the **declared** ids (what clients pin), so don't "fix"
> them; that would break wire-compat.

## 2. Freeze a layer when you ship one

When you ship a layer, snapshot it:

```bash
npx mt-tl freeze ./schema ./schema/layers 205
# → schema/layers/scheme_205.json   (the snapshot the server loads)
# → schema/layers/scheme_205.tl     (human-readable mirror — for inspection/diffs)
```

The `.json` is what the server loads for layered encoding; the `.tl` is a readable
mirror (not loaded). The layer number is the **filename** (`scheme_205.json` → 205),
not the file contents. `defaultLayer` in your config is only the fallback for a
connection that hasn't announced one — not "the schema version".

Then the `.tl` keeps evolving toward 206. **Always freeze the newest shipped layer
too** — otherwise a type that changed in it would encode with a stale id for clients
on that layer. Snapshots must be **identical across all instances**.

## 3. Breaking field changes → migration ladders {#migration-ladders}

A frozen layer handles types that only _gained_ fields. But if a field is **removed
or its type changes** between layers (e.g. `phone: string` became
`phones: Vector<string>`), the _shape_ differs — a `MigrationRegistry` bridges it so
your handlers never branch on layer.

You write a **ladder** per changed predicate: one **rung** per version, ordered by the
layer it was introduced (`since`). Each rung (except the newest) has `up` (this shape
→ next) and `down` (next → this). The server applies `up` on **input** (client →
canonical) and `down` on **output** (canonical → client's layer), so your **handlers
only ever see the newest (canonical) shape**. Adding a version = appending one rung.

```ts
// migrations.ts
import { MigrationRegistry } from '@mt-tl/server'

export const migrations = new MigrationRegistry().register('user', [
    // layer 180: had a single `phone: string`
    {
        since: 180,
        up: u => ({ ...u, phones: u.phone ? [u.phone] : [], phone: undefined }), // → canonical
        down: u => ({ ...u, phone: (u.phones as string[])?.[0] ?? '' }), // ← for old clients
    },
    // layer 205 (canonical): `phones: Vector<string>` — newest rung, no up/down
    { since: 205 },
])
```

Pass it to the server (applied around every handler automatically):

```ts
createServer(config, { migrations }).register(demoApp, { /* … */ })
```

A handler now always sees `user.phones: string[]`. A client on layer 180 sends
`phone` (→ `up` makes `phones`) and gets `phone` back (← `down`); a layer-205 client
sends/gets `phones`. Only predicates that changed _non-additively_ need a ladder —
everything else is handled by decode + layered-encode with no rungs.

## 4. Roll out the new build

A "new version" deploy is just shipping the new code + frozen snapshots. Redeploy your
`serve` replicas behind the load balancer; state is shared in Mongo/Redis, so rolling
restarts are safe — drain a node by stopping new connections and letting in-flight
ones finish. Make sure **every replica has the same `schema/` + `schema/layers/`**.

---

**Next:** [deployment & scaling →](deployment.md)
