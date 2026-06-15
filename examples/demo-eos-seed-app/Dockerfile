# demo-eos-seed-app — single image for every role (serve / gateway-only / workers).
# There is no compile step: tsx runs the TypeScript directly. The container's
# command selects which process to run (see docker-compose.apps.yml).
#
# ⚠️ Build CONTEXT must be the monorepo ROOT (this app is a Yarn workspace and
# needs the sibling @mt-tl/* packages to install). docker-compose.apps.yml sets
# `context: ../..` + this dockerfile path; don't `docker build` from the app dir.
FROM node:20-slim

# Some transitive deps (eosjs-ecc's crypto stack) build cleaner with these.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# Dependency layer: copy only manifests so installs cache across source changes.
COPY .yarnrc.yml package.json yarn.lock ./
COPY packages/tl/package.json packages/tl/
COPY packages/gateway/package.json packages/gateway/
COPY packages/worker-core/package.json packages/worker-core/
COPY examples/demo-eos-seed-app/package.json examples/demo-eos-seed-app/
RUN yarn install --immutable

# Source.
COPY . .

ENV NODE_ENV=production
# Default to the in-process app (gateway + app in one process). Compose overrides
# `command` for split roles (gateway-only / rpc-worker / router).
CMD ["yarn", "workspace", "demo-eos-seed-app", "run", "serve"]
