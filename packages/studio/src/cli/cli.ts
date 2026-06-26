#!/usr/bin/env node
import { buildApiSpec, buildWireDefs } from '@mt-tl/tl'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The pre-built SPA ships in the package at dist/app (this CLI is dist/cli/cli.js).
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'app')

const USAGE = `mt-tl-studio — interactive MTProto API explorer

Usage:
  mt-tl-studio build --layers <dir> --out <dir>
      [--prefix <p>] [--protocol <dir>] [--descriptions <dir>] [--scenarios <dir>] [--changelog <dir>] [--recipes <dir>]
      [--default-url <ws-url>] [--default-key <pem-file>] [--default-obfuscated]
      Assemble a static, self-hostable site: copies the explorer UI, generates
      api.json from your frozen layer snapshots, and (optionally) bundles your
      per-symbol Markdown descriptions + Markdown scenario guides. Host <out> anywhere.
      --prefix must match the snapshot filename prefix you froze with (default "scheme_").
      --protocol points at your overridden protocol schema (same one the server uses),
      so its low-level types are hidden from the docs and the playground speaks it.
`

function fail(msg: string): never {
    console.error(msg + '\n\n' + USAGE)
    process.exit(1)
}
function flag(name: string): string | undefined {
    const i = process.argv.indexOf('--' + name)
    return i >= 0 ? process.argv[i + 1] : undefined
}
function boolFlag(name: string): boolean {
    return process.argv.includes('--' + name)
}

const cmd = process.argv[2]
if (cmd === 'build') {
    const layers = flag('layers')
    const out = flag('out')
    const prefix = flag('prefix')
    const protocol = flag('protocol')
    const descriptions = flag('descriptions')
    if (!layers || !out) fail('build requires --layers <dir> --out <dir>')
    if (!existsSync(APP_DIR))
        fail(`explorer UI not found at ${APP_DIR} — the package may be built incorrectly`)

    mkdirSync(out, { recursive: true })
    cpSync(APP_DIR, out, { recursive: true })
    const spec = buildApiSpec(layers, prefix, protocol)
    writeFileSync(join(out, 'api.json'), JSON.stringify(spec))
    // Flat protocol+business registry the in-browser playground client uses to
    // encode/decode against the consumer's own ws:// server (the "try it" panel).
    writeFileSync(join(out, 'wire.json'), JSON.stringify(buildWireDefs(layers, prefix, protocol)))

    if (descriptions && existsSync(descriptions)) {
        // Chunked: descriptions/index.json (names that have a doc) + descriptions/<name>.md.
        // The studio fetches a symbol's .md only when its page opens (lazy).
        const dir = join(out, 'descriptions')
        mkdirSync(dir, { recursive: true })
        const names: string[] = []
        for (const f of readdirSync(descriptions))
            if (f.endsWith('.md')) {
                names.push(f.slice(0, -3))
                writeFileSync(join(dir, f), readFileSync(join(descriptions, f), 'utf8'))
            }
        writeFileSync(join(dir, 'index.json'), JSON.stringify(names.sort()))
    }

    const scenarios = flag('scenarios')
    if (scenarios && existsSync(scenarios)) {
        // Chunked: scenarios/index.json (slug/title/interactive) + scenarios/<slug>.md.
        // Walk subdirectories so guides can be organised in folders — the slug keeps
        // the relative path (e.g. auth/login), which the studio groups into a tree and
        // mirrors as nested .md files. Bodies load on open, not bundled up front.
        const dir = join(out, 'scenarios')
        const index: { slug: string; title: string; interactive: boolean }[] = []
        const walk = (src: string, base = ''): void => {
            for (const e of readdirSync(src, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                const rel = base ? `${base}/${e.name}` : e.name
                if (e.isDirectory()) walk(join(src, e.name), rel)
                else if (e.name.endsWith('.md')) {
                    const body = readFileSync(join(src, e.name), 'utf8')
                    const h1 = /^#\s+(.+)$/m.exec(body)
                    const slug = rel.slice(0, -3)
                    // "interactive" = embeds a ```scenario block → gets the play badge in the nav.
                    index.push({ slug, title: h1 ? h1[1]!.trim() : slug, interactive: /```scenario\s*\n/.test(body) })
                    const dest = join(dir, `${slug}.md`)
                    mkdirSync(dirname(dest), { recursive: true })
                    writeFileSync(dest, body)
                }
            }
        }
        mkdirSync(dir, { recursive: true })
        walk(scenarios)
        writeFileSync(join(dir, 'index.json'), JSON.stringify(index))
    }

    // Optional authored changelog prose: changelog/<layer>.md → { "<layer>": md }.
    // The Changelog page shows the auto-diff regardless; this prose sits on top.
    const changelog = flag('changelog')
    if (changelog && existsSync(changelog)) {
        // Chunked: changelog/index.json (layers with prose) + changelog/<N>.md (fetched
        // lazily when that layer is selected).
        const dir = join(out, 'changelog')
        mkdirSync(dir, { recursive: true })
        const proseLayers: number[] = []
        for (const f of readdirSync(changelog)) {
            const m = /^(\d+)\.md$/.exec(f)
            if (m) {
                proseLayers.push(Number(m[1]))
                writeFileSync(join(dir, f), readFileSync(join(changelog, f), 'utf8'))
            }
        }
        writeFileSync(join(dir, 'index.json'), JSON.stringify(proseLayers.sort((a, b) => a - b)))
    }

    // Optional baked connection defaults → config.json (the connbar seeds from it,
    // so a consumer's team doesn't paste url/key by hand). `--default-key` is a PEM path.
    const defaultUrl = flag('default-url')
    const defaultKey = flag('default-key')
    const defaultObfuscated = boolFlag('default-obfuscated')
    if (defaultUrl || (defaultKey && existsSync(defaultKey)) || defaultObfuscated) {
        const config: { defaultUrl?: string; defaultPem?: string; defaultObfuscated?: boolean } = {}
        if (defaultUrl) config.defaultUrl = defaultUrl
        if (defaultKey && existsSync(defaultKey)) config.defaultPem = readFileSync(defaultKey, 'utf8')
        // For real Telegram, the obfuscated WS transport is required — let a build default it on.
        if (defaultObfuscated) config.defaultObfuscated = true
        writeFileSync(join(out, 'config.json'), JSON.stringify(config))
    }

    // Optional pre-authored auth recipes → recipes.json (built-in, reusable by the team).
    // <name>.js / <name>.mjs is the ES module; <name>.args.json its default ctx.args.
    const recipesDir = flag('recipes')
    if (recipesDir && existsSync(recipesDir)) {
        const list = readdirSync(recipesDir)
            .filter(f => f.endsWith('.js') || f.endsWith('.mjs'))
            .sort()
            .map(f => {
                const name = f.replace(/\.m?js$/, '')
                const argsFile = join(recipesDir, `${name}.args.json`)
                return {
                    name,
                    code: readFileSync(join(recipesDir, f), 'utf8'),
                    args: existsSync(argsFile) ? readFileSync(argsFile, 'utf8') : '{}',
                }
            })
        writeFileSync(join(out, 'recipes.json'), JSON.stringify(list))
    }
    console.log(
        `Built studio site → ${out} (${Object.keys(spec.methods).length} methods, ` +
            `${Object.keys(spec.types).length} types, layers ${spec.layers.join(', ')})`,
    )
} else if (cmd === undefined || cmd === '-h' || cmd === '--help') {
    console.log(USAGE)
} else {
    fail(`unknown command: ${cmd}`)
}
