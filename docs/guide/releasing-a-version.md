# Releasing a version

In MTProto, a client's "version" is its **TL layer**. Shipping new methods or
changing existing ones means evolving your `.tl` schema and, when you ship, you
**freeze a layer** so older clients keep getting bytes they can decode. This guide
covers the schema lifecycle and rolling out a new build.

## 1. Edit the schema, regenerate types

Your app owns its `.tl` (in `schema/`). Add/change a constructor or method, then:

```bash
yarn workspace demo-eos-seed-app run gen:types
```

This regenerates `src/generated/schema.ts` (the `RpcMethods` map + interfaces).
Your handlers get the new typed `params`/`result` immediately. The `.tl` is always
the **newest, in-progress** layer.

> The CRC32 of each line must match its declared `#id`. The parser validates this
> on load (warns on mismatch). 17 of the vendored constructors have benign
> historical mismatches — the codec uses the **declared** ids (what clients pin),
> so don't "fix" them; that would break wire-compat.

## 2. Freeze a layer when you ship one

Decode is **layer-agnostic** (the wire constructor id is unambiguous). Only result
_encoding_ is layer-specific: the gateway floors a client's negotiated layer to the
nearest **frozen snapshot** and writes that layer's ids/fields. So when you ship a
layer, snapshot it:

```bash
yarn workspace demo-eos-seed-app run freeze 205
# → schema/layers/scheme_205.json   (the IR snapshot the gateway loads)
# → schema/layers/scheme_205.tl     (human-readable mirror — for inspection/diffs)
```

The `.json` is what the gateway loads; the `.tl` is a readable mirror (not loaded)
so you can eyeball or diff a frozen layer.

Then the `.tl` keeps evolving toward 206. **Always freeze the newest shipped layer
too** — otherwise a type that changed in it would encode with a stale id for
clients on that layer. The layer number is the **filename** (`scheme_205.json`
→ 205), not the file contents. `DEFAULT_LAYER` is only the fallback for a connection
that hasn't sent `invokeWithLayer` — not "the schema version".

Snapshots must be **identical across all gateway instances**.

## 3. Breaking field changes → migration ladders

A frozen layer id handles types that only _gained_ fields. But if a field is
**removed or its type changes** between layers (e.g. `phone:string` became
`phones:Vector<string>`), the _shape_ differs — a `MigrationRegistry` bridges it.

You write a **ladder** per changed predicate: one **rung** per version, ordered by
the layer it was introduced (`since`). Each rung (except the newest) has `up`
(this shape → next) and `down` (next → this). The gateway applies `up` on **input**
(client → canonical) and `down` on **output** (canonical → client's layer), so your
**handlers only ever see the newest (canonical) shape** — they never branch on
layer. Adding a version = appending one rung; the existing rungs don't change.

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

Pass it to the server (it's applied around every handler automatically):

```ts
createServer(config, { migrations }).register(demoApp, { … })
```

A handler now always sees `user.phones: string[]`. A client on layer 180 sends
`phone` (→ `up` makes `phones`) and gets `phone` back (← `down` from `phones`); a
layer-205 client sends/gets `phones`. Only predicates that changed
non-additively need a ladder — everything else is handled by decode-union +
layered-encode with no rungs. (Engine: `@mt-tl/tl`'s `MigrationRegistry`.)

## 4. Roll out the new build

A "new version" deploy is just shipping the new code + frozen snapshots. Redeploy
your `serve` replicas behind the load balancer; state is shared in Mongo/Redis, so
rolling restarts are safe — drain a node by stopping new connections and letting
in-flight ones finish.

Make sure every replica has the **same** `schema/` + `schema/layers/`. See
[deployment.md](deployment.md) for scaling and the wire-compat RSA key requirement.

---

Next: [deployment.md](deployment.md) for the rollout topologies in detail.
