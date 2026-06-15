# Docs site (Docusaurus)

The published docs site for mt-tl. The content is **not** here — it's the
markdown in the repo-root [`../docs`](../docs) (single source of truth). This
folder is only the Docusaurus tooling, which reads `../docs` via the docs
plugin's `path` option.

## Run it locally

This site is a Yarn workspace (`mt-tl-docs`), so a root `yarn install`
installs its deps too. From the repo root:

```bash
yarn install                              # once (pulls Docusaurus + React)
yarn workspace mt-tl-docs start      # dev server at http://localhost:3000
```

Other scripts (same pattern): `build` (static site → `website/build/`), `serve`
(serve a build), `typecheck`, `clear`. You can also `cd website && yarn start`.

## Deployment — GitHub Pages

Configured for a GitHub Pages **project site** at
**https://joeberetta.github.io/mt-tl/**. The relevant constants are at the
top of [`docusaurus.config.ts`](docusaurus.config.ts): `SITE_URL`,
`baseUrl` (`/mt-tl/`), `REPO_URL`, `ORG_NAME`, `PROJECT_NAME`.

Deploy is automated by [`.github/workflows/deploy-docs.yml`](../.github/workflows/deploy-docs.yml):
on a push to `main` that touches `docs/**` or `website/**`, it builds the site and
publishes `website/build/` to Pages. One-time setup: in the repo, **Settings →
Pages → Source = GitHub Actions**. You can also trigger it manually from the
Actions tab (`workflow_dispatch`).

Note: a few links in `../docs` point at repo files (`../../examples/…`,
`../../packages/…`). Those resolve on GitHub but not on the site, so they surface
as broken-link **warnings** (`onBrokenLinks: 'warn'`) — harmless. To clear them,
make those links absolute (`https://github.com/joeberetta/mt-tl/blob/main/…`).
