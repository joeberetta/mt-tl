# Studio — explore & document your API

REST APIs have Swagger / Redoc; MTProto is binary, so your client developers can't
just "see" your API. **`@mt-tl/studio`** fixes that. Point it at your `.tl` layers and
it builds a static doc site — a layer-aware reference, the full schema, a changelog,
prose guides, and a live **"try it" playground** that speaks real MTProto from the
browser.

It's a published package with a CLI (`mt-tl-studio`), so anyone can install it and
spin up docs for their own schema:

```bash
npm install -D @mt-tl/studio
```

## Two ways to use it

- **Standalone docs (like this site).** Point it at a directory of `.tl` files,
  publish the static output (GitHub Pages, S3, nginx) for your team. No server needed
  to browse.
- **Alongside your `@mt-tl/server`.** Deploy the site next to your gateway so readers
  can run **live calls** against your `ws://` server — try-it, multi-user scenarios,
  and a listener for pushed updates.

## Build your first site

Studio reads your **per-layer** schema — either raw `scheme_<N>.tl` files or the
frozen `scheme_<N>.json` snapshots that
[`mt-tl freeze`](releasing-a-version.md#2-freeze-a-layer-when-you-ship-one) produces
(`.json` wins when both exist). Point the CLI at that directory:

```bash
mt-tl-studio build --layers ./schema/layers --out ./site
npx serve ./site                # browse http://localhost:3000
```

That's a complete, self-contained doc site. Host `./site` on any static host.

## What's in the site

- **Reference** — every method and type, rendered **per layer** (switch the layer and
  the reference updates to that version's shape).
- **Schema** — the full `.tl` view with cross-linked types.
- **Changelog** — an auto-generated added / changed / removed diff between layers.
- **Guides** — your prose scenario docs, grouped in a sidebar tree.
- **Try it** / **Builder** / **Listen** — live calls, multi-user scenario building, and
  watching pushed updates (when pointed at a running server).

## Author the docs (incremental)

Everything beyond `--layers` is optional — add it over time and re-run `build`:

```bash
mt-tl-studio build \
  --layers ./schema/layers --out ./site \
  --descriptions ./descriptions \   # <symbol>.md  → shown on each method/type page
  --scenarios ./scenarios \         # <folder>/<guide>.md → grouped guides
  --changelog ./changelog           # <layer>.md   → prose above the auto-diff
```

- **descriptions/** — `account.checkFields.md`, `User.md`, … Markdown rendered on the
  matching method/type/constructor page.
- **scenarios/** — guides in folders (e.g. `auth/login.md`). Embed a fenced
  ` ```scenario ` block (the same YAML as [`mtproto-test`](testing.md)) and the studio
  shows a ▶ badge with an "open as interactive scenario" button that pre-fills the
  builder — so a guide is also runnable.
- **changelog/** — `205.md` etc.; the prose sits above the auto-generated per-layer
  diff.

## Live calls (try it)

In the connection bar, set your server's `ws://` URL and paste its **RSA public key
(PEM)** — clients pin it for the handshake. Then call methods, build multi-user
scenarios, or watch updates on the Listen page. Auth is per-request: `auth: false`
methods run anonymously; for logged-in flows write an **auth recipe** — a small ES
module that default-exports `async (ctx) => { … }` and performs your login (it can
`import` your own crypto to sign at runtime).

To skip pasting the URL/key on every visit, bake defaults into the build for a team
deployment:

```bash
mt-tl-studio build --layers ./schema/layers --out ./site \
  --default-url wss://api.example.com/mtproto \
  --default-key ./server-pub.pem \
  --recipes ./recipes               # ship reusable auth recipes with the site
```

> **Talking to real Telegram.** Studio can also point at Telegram itself — tick
> **obfuscated transport** and use Telegram's RSA key + your `api_id`. Useful for
> exploration, but for your own product you point it at your `@mt-tl/server` gateway.

## Full CLI reference

Every flag (`--recipes`, `--default-obfuscated`, …) and the authoring details are in
the package's own README:
[`@mt-tl/studio` README](https://github.com/joeberetta/mt-tl/tree/master/packages/studio#readme).

---

**Next:** [schema versions & layers →](releasing-a-version.md)
