# QA scenarios for the demo app

This folder shows how to drive the demo with
[`@mt-tl/testing`](../../../packages/testing)'s `mtproto-test` CLI.

- [`recipes.ts`](recipes.ts) — auth recipes for this app's EOS login
  (`eos-signup`, `eos-signin`, `eos-auth`). The CLI is auth-agnostic; recipes are
  where an app encodes its crypto handshake.
- [`chat.scenario.yaml`](chat.scenario.yaml) — an example multi-user scenario.

## Run against a stand

```bash
# from examples/demo-eos-seed-app
yarn mtproto-test run testing/chat.scenario.yaml --recipes testing/recipes.ts
```

(`yarn mtproto-test` resolves to `@mt-tl/testing`'s bin.) You need the stand's
RSA **public** key at the `publicKey` path in the scenario.

## Reproduce on another stand

Keep the scenario, swap the connection + credentials in a config overlay:

```yaml
# testing/stand-staging.yaml
target: { url: wss://staging.example/mtproto, publicKey: ./staging-pub.pem }
vars: { ALICE_SEED: '...', BOB_SEED: '...' }
```

```bash
yarn mtproto-test run testing/chat.scenario.yaml \
  --recipes testing/recipes.ts --config testing/stand-staging.yaml
```

The recipes are exercised in-process by
[`test/qa-recipes.test.ts`](../test/qa-recipes.test.ts).
