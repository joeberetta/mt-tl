# @mt-tl/studio

A self-hosted, interactive **explorer + playground for an MTProto TL schema** — the
"Swagger/Redoc for MTProto". Point it at your `.tl` layers and get a static site with a
layer-aware reference, a full schema view, a changelog, prose guides, and a live "try it"
playground that speaks real MTProto from the browser.

It ships a **pre-built static app**; a small CLI assembles a site by generating the data
files (`api.json`, `wire.json`, …) from your schema and copying them next to the app.

## Two ways to use it

- **(a) Alongside `@mt-tl/server`** — deploy the site next to your gateway and read your own
  docs / run live calls against your `ws://` server (try-it + scenario runner + listener).
- **(b) Standalone docs (like Docusaurus)** — point it at a directory of `.tl` files,
  publish the static site (e.g. GitHub Pages) for your team. No server required to browse.

## Install

Requires **Node 20+**. Installs a `mt-tl-studio` CLI; the package ships the pre-built
explorer UI, so there's nothing else to set up.

```bash
npm i -D @mt-tl/studio        # or: yarn add -D @mt-tl/studio
```

> Building a server with `@mt-tl/server`? The framework docs have a walkthrough of
> Studio in context: **[the Studio guide](https://github.com/joeberetta/mt-tl/blob/master/docs/guide/studio.md)**.

## Quick start

Put your per-layer schema as `scheme_<N>.tl` (one file per layer; each is the full schema
at that layer) in a directory, then build:

```bash
mt-tl-studio build --layers ./schema --out ./site
npx serve ./site               # browse http://localhost:3000
```

`--layers` accepts either raw `scheme_<N>.tl` files **or** frozen `scheme_<N>.json`
snapshots (the framework's `mt-tl freeze` output); `.json` wins when both exist.

## Authoring docs (incremental)

Everything below is optional — add it over time. Re-run `build` to regenerate.

```bash
mt-tl-studio build \
  --layers ./schema --out ./site \
  --descriptions ./descriptions \   # <symbol>.md  → rendered on method/type/constructor pages
  --scenarios ./scenarios \         # <folder>/<guide>.md → grouped guides (tree in the sidebar)
  --changelog ./changelog           # <layer>.md   → prose intro above the auto-diff
```

- **descriptions/** — `account.checkFields.md`, `User.md`, … Markdown shown on each page.
- **scenarios/** — guides in folders, e.g. `auth/login.md`. Embed a fenced ` ```scenario `
  block (mt-tl-test YAML) to make a guide **runnable** — the studio shows a ▶ badge and an
  "open as interactive scenario" button that pre-fills the builder.
- **changelog/** — `205.md` etc.; the per-layer prose sits above the auto-generated
  added / changed / removed diff.

## Try it (live calls)

In the connection bar: set your server `ws://` URL and paste its **RSA public key (PEM)**
(clients pin it for the handshake). Then call methods on the method page, build multi-user
scenarios, or watch pushed updates on the Listen page. Auth is per-request: `auth:false`
methods run anonymously; for logged-in flows write an **auth recipe** — a small ES module
that default-exports `async (ctx) => { … }` and does your login (it may `import` your own
crypto to sign at runtime).

By default the client speaks the **mt-tl** MTProto profile (RSA-pinned via the PEM you
provide, plain intermediate framing) — for servers built with `@mt-tl/server`.

> **Talking to real Telegram.** Tick **obfuscated transport (Telegram)** in the key panel and
> the client switches to the WebSocket transport Telegram requires (`Sec-WebSocket-Protocol:
> binary` + the obfuscated/AES-CTR stream). Paste Telegram's server RSA key, set your `api_id`
> (from [my.telegram.org](https://my.telegram.org)), point the URL at a Telegram WS endpoint
> (e.g. `wss://venus.web.telegram.org/apiws_test` for the test DC), and unauthenticated calls
> like `help.getConfig` work. Logged-in methods still need the full Telegram auth flow.

## CLI

```
mt-tl-studio build --layers <dir> --out <dir>
    [--descriptions <dir>] [--scenarios <dir>] [--changelog <dir>] [--recipes <dir>]
    [--default-url <ws-url>] [--default-key <pem-file>] [--default-obfuscated]
```

- `--recipes <dir>` — bundle ready auth recipes (`<name>.js`/`.mjs` ES modules, optional
  `<name>.args.json`) so your team reuses them out of the box (shown alongside locally-saved
  ones).
- `--default-url` / `--default-key` — bake a default `ws://` URL + server RSA public-key PEM
  into the site (`config.json`); the connection bar seeds from them (a user's own saved value
  still wins). Handy for a team deployment so nobody pastes the URL/key by hand.
- `--default-obfuscated` — default the **obfuscated WebSocket transport** on. Required to talk
  to real Telegram (which also needs its server RSA key + your `api_id`); leave it off for an
  `@mt-tl/server` gateway.

Host `<out>` on any static host (GitHub Pages, S3, nginx, …).
