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

---

## CLI — `mtproto-test`

Describe a flow once in YAML, run it against any stand, reproduce it elsewhere by
swapping `--config`.

```bash
mtproto-test run scenario.yaml
mtproto-test run scenario.yaml --config stand-staging.yaml --recipes ./recipes.ts
mtproto-test run scenario.yaml --format json   # machine-readable report
```

Exit code: `0` if every step passed, `1` if any failed, `2` on a setup error.

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

### Choosing the connection layer

By default the client runs at the server's `defaultLayer`. Negotiate a specific
TL layer (sends `invokeWithLayer(initConnection(...))` on the first call) with
`target.layer` in the scenario, or `connect({ layer })` / `TestSession.open(...,
{ layer })` in the library.

### Embed the runner

Everything the CLI does is available programmatically from
`@mt-tl/testing/cli` (`runScenario`, `runFromFiles`, `loadScenario`,
`applyOverlay`, `formatReport`, plus the `Scenario`/`Recipe` types).
