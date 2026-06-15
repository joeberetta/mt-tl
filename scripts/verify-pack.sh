#!/usr/bin/env bash
# Verify the PUBLISHED shape locally, without touching the npm registry.
#
# `yarn pack` produces a tarball byte-identical to what `npm publish` would ship:
# it runs `prepack` (the tsc build → dist/), applies `publishConfig` (exports →
# dist), and rewrites `workspace:*` deps to real versions. We then install all
# three tarballs into a throwaway project and load them with PLAIN node (no tsx) —
# the same path a real consumer hits. This is more faithful than `npm link`, which
# symlinks the raw package and does NOT apply publishConfig.
#
# Usage:  bash scripts/verify-pack.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ packing @mt-tl/tl + @mt-tl/server + @mt-tl/testing (runs prepack build)…"
yarn --cwd "$ROOT" workspace @mt-tl/tl pack --out "$TMP/mt-tl.tgz"
yarn --cwd "$ROOT" workspace @mt-tl/server pack --out "$TMP/mtproto-server.tgz"
yarn --cwd "$ROOT" workspace @mt-tl/testing pack --out "$TMP/mtproto-testing.tgz"

echo "→ installing the tarballs into a throwaway project…"
cd "$TMP"
npm init -y >/dev/null 2>&1
npm install ./mt-tl.tgz ./mtproto-server.tgz ./mtproto-testing.tgz >/dev/null 2>&1

echo "→ loading the built packages with plain node…"
cat > smoke.mjs <<'EOF'
import { createServer, BadRequestError } from '@mt-tl/server'
import { MigrationRegistry, protocolSchemaDir } from '@mt-tl/tl'
import { TestClient, createTestServer, wsTransport } from '@mt-tl/testing'
import { existsSync } from 'node:fs'

const app = createServer({
    nodeId: 'verify',
    defaultLayer: 204,
    schemaDir: '.',
    schemaLayersDir: '.',
    storage: { backend: 'memory' },
    updates: { enabled: false, presenceTtlMs: 0 },
})
app.method('demo.echo', { auth: false }, async params => ({ _: 'demo.echoed', n: params.n }))
const res = await app.inject({
    id: '1',
    method: 'demo.echo',
    params: { n: 7 },
    context: { sessionId: '0', authKeyId: '0', apiLayer: 204 },
})
if (res.result?.n !== 7) throw new Error('inject failed: ' + JSON.stringify(res))
if (typeof MigrationRegistry !== 'function') throw new Error('MigrationRegistry missing')
if (typeof BadRequestError !== 'function') throw new Error('BadRequestError missing')
if (!existsSync(protocolSchemaDir)) throw new Error('protocol schema not shipped')
for (const [n, v] of [['TestClient', TestClient], ['createTestServer', createTestServer], ['wsTransport', wsTransport]])
    if (typeof v !== 'function') throw new Error(`@mt-tl/testing ${n} missing`)
console.log('✓ createServer + inject round-trip:', JSON.stringify(res.result))
console.log('✓ MigrationRegistry / BadRequestError exported')
console.log('✓ protocol schema present at', protocolSchemaDir)
console.log('✓ @mt-tl/testing: TestClient / createTestServer / wsTransport exported')
EOF
node smoke.mjs

echo "→ checking the CLI bins…"
npx --no-install mt-tl --help | head -1
npx --no-install mtproto-test --help | head -1

echo "✅ pack verification passed"
