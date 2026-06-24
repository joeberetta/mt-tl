# Testing

Two levels, two tools. Test your **handlers** fast with `app.inject` (no socket, no
crypto). Test the **full stack** — real handshaking client → engine → your handlers —
with `@mt-tl/testing`, in code or as YAML scenarios.

## Unit: `app.inject` (built into `@mt-tl/server`)

`app.inject(req)` dispatches a request against your routes without opening a socket —
fast tests of your handler logic, no transport, no crypto:

```ts
const app = createServer(cfg).register(demoApp, { serverSeed, ecc })

const res = await app.inject({ method: 'help.getConfig', params: {}, context: {} })
expect(res.result._).toBe('config')
```

This exercises dispatch, the auth gate, your pre-handlers, and your handler — the
parts you wrote — and is what most of your test suite should be. The `context` you
pass stands in for what the engine would forward (e.g. set a bound `subject` to test
an authed route).

## Full stack: `@mt-tl/testing` (optional, dev)

When you want to prove the **real** path works — handshake, AES-IGE, sessions, layer
negotiation, server-push — boot the actual server in-process and drive it with a real
client:

```ts
import { createTestServer, createHarness } from '@mt-tl/testing'

const server = await createTestServer<RpcMethods>({
    schemaDir,
    schemaLayersDir: layersDir,
    register: app => app.register(myPlugin, deps), // exactly like createServer
})

const alice = await server.connect() // transport + handshake done
const cfg = await alice.invoke('help.getConfig') // → the rpc_result payload (throws RpcError on error)
const upd = await alice.expectUpdate('updateShort') // waits for a server-push

// Multiple users, each its own auth key + connection:
const h = createHarness(server)
const [u1, u2] = [await h.user('u1'), await h.user('u2')]
await u1.invoke('messages.sendMessage', { /* … */ })
await u2.expectUpdate('updateNewMessage') // assert the push arrived at the other user
h.closeAll()
await server.close()
```

`invoke` is generic over your `RpcMethods`, so you get **method-name autocomplete and
typed params/results** — generate the map the same way you generate your server's
(`mtproto-test types --schema ./schema --out generated/methods.ts`), then
`server.connect<RpcMethods>()`. You can also point a session at a **remote** stand
(`TestSession.open(url, publicKey, codec)`) to smoke-test a deployed environment.

## Scenarios: `mtproto-test` (YAML)

Describe a flow once in YAML and run it against any stand — great for multi-user
flows and CI. One file can coordinate several users, on different layers, mixing
authenticated and anonymous sessions:

```yaml
target:
    url: ws://127.0.0.1:8081
    schema: ./schema
    publicKey: ./server-pub.pem

users:
    alice: { auth: { recipe: eos-signup, with: { seed: ${ALICE_SEED} } } }
    bob: { auth: { recipe: eos-signup, with: { seed: ${BOB_SEED} } } }

steps:
    - as: alice
      invoke: messages.sendMessage
      params: { peer: { _: inputPeerUser, user_id: ${bob.id} }, message: 'hi bob' }
      expect: { _: updates }
    - { as: bob, expectUpdate: { _: updateNewMessage, 'message.message': 'hi bob' } }
```

```bash
mtproto-test run scenario.yaml              # one scenario
mtproto-test run ./scenarios                # every *.yaml under a dir — your CI gate
mtproto-test lint ./scenarios --schema ./schema   # offline: catch typos without connecting
```

Logins that need client-side crypto (sign a challenge, derive a key) are handled by
**recipes** — small TS functions you pass with `--recipes`; a complete EOS example
lives in the demo app's `testing/recipes.ts`. The same scenario re-runs on another
stand by swapping `--config`.

The full API — typed `invoke` across layers, the scenario step kinds
(`expect`/`expectError`/`expectUpdate`/`capture`), editor autocomplete, and embedding
the runner — is in the
[`@mt-tl/testing` README](https://github.com/joeberetta/mt-tl/blob/master/packages/testing/README.md).

## What to test where

- **Business logic** (services, mappers) → plain unit tests, no framework.
- **Routes** (auth gate, hooks, handler shape) → `app.inject`.
- **The wire path** (crypto, layers, multi-user push) → `@mt-tl/testing` or a YAML
  scenario.

---

**Next:** [studio →](studio.md)
