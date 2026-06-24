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
      [--descriptions <dir>] [--scenarios <dir>] [--changelog <dir>] [--recipes <dir>]
      [--default-url <ws-url>] [--default-key <pem-file>] [--default-obfuscated]
      Assemble a static, self-hostable site: copies the explorer UI, generates
      api.json from your frozen layer snapshots, and (optionally) bundles your
      per-symbol Markdown descriptions + Markdown scenario guides. Host <out> anywhere.
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
    const descriptions = flag('descriptions')
    if (!layers || !out) fail('build requires --layers <dir> --out <dir>')
    if (!existsSync(APP_DIR)) fail(`explorer UI not found at ${APP_DIR} — the package may be built incorrectly`)

    mkdirSync(out, { recursive: true })
    cpSync(APP_DIR, out, { recursive: true })
    const spec = buildApiSpec(layers)
    writeFileSync(join(out, 'api.json'), JSON.stringify(spec))
    // Flat protocol+business registry the in-browser playground client uses to
    // encode/decode against the consumer's own ws:// server (the "try it" panel).
    writeFileSync(join(out, 'wire.json'), JSON.stringify(buildWireDefs(layers)))

    if (descriptions && existsSync(descriptions)) {
        const map: Record<string, string> = {}
        for (const f of readdirSync(descriptions))
            if (f.endsWith('.md')) map[f.slice(0, -3)] = readFileSync(join(descriptions, f), 'utf8')
        writeFileSync(join(out, 'descriptions.json'), JSON.stringify(map))
    }

    const scenarios = flag('scenarios')
    if (scenarios && existsSync(scenarios)) {
        // Walk subdirectories so guides can be organised in folders — the slug keeps
        // the relative path (e.g. auth/login), which the studio groups into a tree.
        const walk = (dir: string, base = ''): { slug: string; title: string; body: string }[] => {
            const out2: { slug: string; title: string; body: string }[] = []
            for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                const rel = base ? `${base}/${e.name}` : e.name
                if (e.isDirectory()) out2.push(...walk(join(dir, e.name), rel))
                else if (e.name.endsWith('.md')) {
                    const body = readFileSync(join(dir, e.name), 'utf8')
                    const h1 = /^#\s+(.+)$/m.exec(body)
                    const slug = rel.slice(0, -3)
                    out2.push({ slug, title: h1 ? h1[1]!.trim() : slug, body })
                }
            }
            return out2
        }
        writeFileSync(join(out, 'scenarios.json'), JSON.stringify(walk(scenarios)))
    }

    // Optional authored changelog prose: changelog/<layer>.md → { "<layer>": md }.
    // The Changelog page shows the auto-diff regardless; this prose sits on top.
    const changelog = flag('changelog')
    if (changelog && existsSync(changelog)) {
        const map: Record<string, string> = {}
        for (const f of readdirSync(changelog)) {
            const m = /^(\d+)\.md$/.exec(f)
            if (m) map[m[1]!] = readFileSync(join(changelog, f), 'utf8')
        }
        writeFileSync(join(out, 'changelog.json'), JSON.stringify(map))
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
