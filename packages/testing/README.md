# @mt-tl/testing

End-to-end test tooling for servers built on
[`@mt-tl/server`](../server) + [`@mt-tl/tl`](../tl). Two things in one package:

1. **A library** — boot your server in-process and drive it with a real,
   handshaken MTProto client. Framework-agnostic (vitest, jest, anything).
2. **A CLI** (`mtproto-test`) — run **YAML scenarios** against any stand, swap a
   config to re-run on another stand, coordinate multiple users in one file.

---

## Library

```ts
import { createTestServer, createHarness } from '@mt-tl/testing'

const server = await createTestServer<RpcMethods>({
    schemaDir, // your business .tl (protocol auto-merged)
    schemaLayersDir: layersDir,
    register: app => app.register(myPlugin, deps), // exactly like createServer
})

const alice = await server.connect() // transport + handshake done
const cfg = await alice.invoke('help.getConfig') // → the rpc_result payload
//   (throws RpcError on rpc_error)
const upd = await alice.expectUpdate('updateShort') // waits for a server-push

// Multiple users, each its own auth key + connection:
const h = createHarness(server)
const [u1, u2] = [await h.user('u1'), await h.user('u2')]
await u1.invoke('messages.sendMessage', {
    /* ... */
})
await u2.expectUpdate('updateNewMessage')
h.closeAll()
await server.close()
```

- `createTestServer(opts)` → boots the real `createServer` on an ephemeral port
  with in-memory storage + in-memory push. Returns `{ app, url, publicKey, codec,
connect(), close() }`.
- `TestSession` — `invoke(method, params?)` auto-unwraps service messages
  (`new_session_created`/`msgs_ack`/…) and returns the `rpc_result` payload, or
  throws `RpcError(code, message)`. `expectUpdate(match, { timeoutMs })` waits for
  a pushed update (`match` is a predicate or a bare constructor name). `.raw` is
  the low-level `TestClient`.
- `createHarness(server)` — named, independently-authenticated sessions.

Connect to a **remote** stand instead of an in-process server:

```ts
import { TestSession, createCodec } from '@mt-tl/testing'
import { createPublicKey } from 'node:crypto'

const codec = createCodec(schemaDir)
const publicKey = createPublicKey(fs.readFileSync('server-pub.pem'))
const session = await TestSession.open('wss://stand.example/mtproto', publicKey, codec)
```

### Typed `invoke` — method autocomplete in your editor

`invoke` is generic over your method map, so `TestSession<RpcMethods>` gives you
**method-name autocomplete** and **typed params + results** — no more guessing
method names or shapes in a test. Generate the `RpcMethods` map from your `.tl`
schema (the same generator `@mt-tl/tl` ships):

```bash
mtproto-test types --schema ./schema --out generated/methods.ts
```

Then parametrise the session with it:

```ts
import type { RpcMethods } from './generated/methods'

// in-process server, typed end-to-end:
const server = await createTestServer<RpcMethods>({ schemaDir, register })
const alice = await server.connect<RpcMethods>()
//                            ^ autocompletes the method, checks params, types the result
const sent = await alice.invoke('crypto.sendCode', { public_key, api_id, api_hash })
//    ^? CryptoSentCode

// or a remote stand:
const s = await TestSession.open<RpcMethods>('wss://stand.example/mtproto', publicKey, codec)
```

Omit the type param and a session is `TestSession<AnyMethods>` — `invoke(anyName,
{ … })` stays valid and returns a `TlObject`, exactly as before. Typing is purely
opt-in: regenerate `methods.ts` whenever the schema changes (wire it into your
`gen:types` script and commit it, or `.gitignore` it and generate in CI).

#### Typing across several layers

The negotiated layer (`connect({ layer })`) is a **runtime** knob; the types come
from the **schema** you generate from. So to test multiple layers with per-layer
type-safety, generate one map per **frozen** layer schema and bind each to the
layer you negotiate. `--schema` takes a single `.tl` file, so a frozen snapshot
needs no folder of its own:

```bash
mtproto-test types --schema ./scheme/scheme_203.tl --out generated/methods-203.ts
mtproto-test types --schema ./scheme/scheme_204.tl --out generated/methods-204.ts
```

```ts
const s203 = await TestSession.open<RpcMethods203>(url, key, codec, { layer: 203 })
const s204 = await TestSession.open<RpcMethods204>(url, key, codec, { layer: 204 })
//    each `invoke` is checked against exactly that layer's method set
```

A layer still in development (not frozen yet) is just another schema: generate a
throwaway `methods-205.ts` from the work-in-progress `.tl` and type the new tests
against it until you freeze. The runtime `codec` can stay shared (the client
decodes by constructor id); only the **type map** is per-layer.

---

## CLI — `mtproto-test`

Describe a flow once in YAML, run it against any stand, reproduce it elsewhere by
swapping `--config`.

| command  | what it does                                                                    |
| -------- | ------------------------------------------------------------------------------- |
| `run`    | run one scenario **or every `*.yaml` in a directory** (CI), with a pass report  |
| `lint`   | validate scenarios against your schema **without connecting** (fast, offline)   |
| `schema` | emit `scenario.schema.json` for **editor autocomplete + linting** of the YAML   |
| `types`  | emit the `RpcMethods` `.ts` for **typed `invoke`** in your jest/vitest tests    |

```bash
mtproto-test run scenario.yaml
mtproto-test run scenario.yaml --config stand-staging.yaml --recipes ./recipes.ts
mtproto-test run scenario.yaml --format json   # machine-readable report

# Run EVERY scenario under a directory (recursively) — one process, for CI:
mtproto-test run ./scenarios
```

Exit code: `0` if every scenario passed, `1` if any step/scenario failed, `2` on a
setup error. Pointing `run` at a **directory** discovers every `*.yaml` /
`*.yml` under it, runs them in turn, prints a per-scenario summary, and exits
non-zero if **any** scenario failed — so a single `mtproto-test run ./scenarios`
is your whole CI gate. `--format json` then emits an array of `{ file, report }`.

### Scenario

```yaml
target:
  url: ws://127.0.0.1:8081       # ws:// | wss:// | tcp://host:port
  schema: ./schema               # your business .tl dir (relative to this file)
  publicKey: ./server-pub.pem    # the stand's RSA public key (PEM)

vars:                            # free variables for ${...} interpolation
  greeting: "hi bob"

users:                           # each is authenticated before steps run
  alice:
    auth: { recipe: eos-signup, with: { seed: ${ALICE_SEED} } }
  bob:
    auth: { recipe: eos-signup, with: { seed: ${BOB_SEED} } }

steps:
  - as: alice
    invoke: messages.sendMessage
    params: { peer: { _: inputPeerUser, user_id: ${bob.id} }, message: ${greeting} }
    expect: { _: updates }                     # subset-match on the result
  - { as: bob,   expectUpdate: { _: updateNewMessage, "message.message": ${greeting} } }
  - { as: bob,   invoke: messages.sendMessage, params: { peer: { _: inputPeerUser, user_id: ${alice.id} }, message: "hey" } }
  - { as: alice, expectUpdate: updateNewMessage }
```

**Step kinds** (exactly one of `invoke` / `expectUpdate` per step):

| field          | meaning                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `as`           | which user runs it (omit when there's one user)                          |
| `invoke`       | method name; `params` are interpolated                                   |
| `expect`       | subset-match the `rpc_result` payload (`{ "a.b": value }`, dotted paths) |
| `expectError`  | assert it fails: `{ code?, message? }`                                   |
| `expectUpdate` | wait for a matching pushed update (a name, or a `{ path: value }` map)   |
| `capture`      | save result/update fields into the scope: `{ 'bob.id': 'user.id' }`      |
| `timeoutMs`    | per-step timeout                                                         |

**`${...}` interpolation** resolves against `vars`, `${env.NAME}`, and any
`capture`d values (e.g. `${bob.id}` after a step did `capture: { 'bob.id': 'user.id' }`).
A string that is exactly `${path}` yields the raw value (number/object preserved).

### Config overlay — reproduce on another stand

The same scenario, a different stand and credentials:

```yaml
# stand-staging.yaml
target: { url: wss://staging.example/mtproto, publicKey: ./staging-pub.pem }
vars: { ALICE_SEED: '...', BOB_SEED: '...' }
```

`mtproto-test run scenario.yaml --config stand-staging.yaml` deep-merges the
overlay over the scenario (overlay wins) before running.

### Auth recipes — the extension seam

The tool is auth-agnostic. For plain-RPC logins, put the calls under
`auth.steps`. For logins that need client-side crypto (sign a challenge, derive a
key), write a **recipe** and pass `--recipes`:

```ts
// recipes.ts
import type { RecipeMap } from '@mt-tl/testing/cli'

export const recipes: RecipeMap = {
    'eos-signup': async ({ session, args, scope, user }) => {
        const sent = await session.invoke('crypto.sendCode', {
            /* ... */
        })
        const sign = signWithSeed(sent.code, args.seed) // your crypto
        const auth = await session.invoke('crypto.signUp', { /* ..., */ sign })
        scope.set(`${user}.id`, auth.user.id) // now ${alice.id} works
    },
}
```

A complete, working example (EOS `eos-signup`/`eos-signin`/`eos-auth`) lives in
[`examples/demo-eos-seed-app/testing/recipes.ts`](../../examples/demo-eos-seed-app/testing/recipes.ts).

### Layers & anonymous sessions — different users, different versions

By default every user connects at the server's `defaultLayer`. Set a baseline for
the whole scenario with `target.layer`, and **override it per user** with
`users.<name>.layer` — so one scenario can connect users on **different layers**
(e.g. test that a v204 client and a v185 client interoperate). Each negotiates by
sending `invokeWithLayer(initConnection(...))` on its first call; override the
`initConnection` fields (`api_id`, `device_model`, …) per user too.

A user with **no `auth`** is an **anonymous session**: it still connects and
handshakes, just unauthenticated — use it to test pre-login calls (and assert
that auth-required methods fail). Mix authenticated and anonymous users freely in
the same file:

```yaml
target:
  url: wss://stand.example/mtproto
  schema: ./schema
  publicKey: ./server-pub.pem
  layer: 204 # baseline for everyone

users:
  modern:
    layer: 204 # explicit (same as the baseline here)
    auth: { recipe: eos-signin, with: { mnemonic: ${MODERN_SEED} } }
  legacy:
    layer: 185 # this user negotiates an OLDER layer
    initConnection: { device_model: 'Legacy 1.0' }
    auth: { recipe: eos-signin, with: { mnemonic: ${LEGACY_SEED} } }
  guest: {} # anonymous: connects + handshakes, no login

steps:
  - { as: guest, invoke: help.getConfig, expect: { _: config } } # pre-auth call works
  - { as: guest, invoke: account.getAccount, expectError: { code: 401 } } # auth required → fails
  - { as: modern, invoke: messages.sendMessage, params: { peer: { _: inputPeerUser, user_id: ${legacy.id} }, message: hi } }
  - { as: legacy, expectUpdate: { _: updateNewMessage } } # the v185 client still receives it
```

In the **library**, the same knobs are `connect({ layer, initConnection })` /
`TestSession.open(url, key, codec, { layer })`; read back the negotiated layer
with `session.negotiatedLayer`.

### Editor autocomplete & offline linting

You don't hand-write `scenario.schema.json` — **generate it** from your `.tl`
schema. It's a JSON Schema (draft-07) describing the scenario shape, with the
`invoke:` field constrained to an **enum of your actual method names** and
matchers to your constructor names:

```bash
mtproto-test schema --schema ./schema --out scenario.schema.json
```

Point your editor at it once (top of each scenario file) for autocomplete +
inline validation in VS Code's YAML extension:

```yaml
# yaml-language-server: $schema=./scenario.schema.json
```

Regenerate it whenever the schema changes (wire it into a `gen:schema` script).
For **offline CI validation** — catch typos in method names / bad structure
**without connecting to any stand** — lint the files:

```bash
mtproto-test lint ./scenarios --schema ./schema   # generates the schema + validates
mtproto-test lint ./scenarios --schema-file scenario.schema.json   # reuse a generated one
```

`lint` exits non-zero on the first invalid scenario, listing the offending paths —
a fast pre-flight before the connecting `run`.

### Embed the runner

Everything the CLI does is available programmatically from
`@mt-tl/testing/cli` (`runScenario`, `runFromFiles`, `loadScenario`,
`applyOverlay`, `formatReport`, plus the `Scenario`/`Recipe` types).
