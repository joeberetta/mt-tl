import { dirname, isAbsolute, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createPublicKey } from 'node:crypto'
import type { TlObject } from '@mt-tl/tl'
import { createCodec } from '../codec.js'
import { TestSession, type InvokeTrace } from '../session.js'
import { wsTransport, tcpTransport } from '../client/transport.js'
import { loadScenario, type TargetSpec } from './scenario.js'
import { loadConfig, applyOverlay } from './config.js'
import { loadRecipeModule } from './recipes.js'
import { runScenario, type RunReport } from './runner.js'

export interface RunArgs {
    /** Path to the scenario YAML. */
    scenario: string
    /** Optional per-stand config-overlay YAML. */
    config?: string
    /** Optional recipes module (for `auth.recipe` + custom `generators`). */
    recipes?: string
    /** `--var k=v` overrides, merged over the scenario/overlay `vars`. */
    vars?: Record<string, string>
    /** Print the full request/response of every call (to the log sink). */
    verbose?: boolean
    /** Environment for `${env.*}`; defaults to `process.env`. */
    env?: Record<string, string | undefined>
    /** Per-step progress sink; defaults to stderr. */
    log?: (line: string) => void
}

/**
 * Load a scenario (+ optional overlay/recipes), build a connection from its
 * `target`, and run it. Returns the {@link RunReport}; the bin prints it and sets
 * the exit code.
 */
export async function runFromFiles(args: RunArgs): Promise<RunReport> {
    const scenarioPath = resolve(args.scenario)
    const baseDir = dirname(scenarioPath)
    const log = args.log ?? ((line: string) => process.stderr.write(line + '\n'))

    let scenario = loadScenario(scenarioPath)
    if (args.config) scenario = applyOverlay(scenario, loadConfig(resolve(args.config)))
    if (args.vars) scenario = { ...scenario, vars: { ...(scenario.vars ?? {}), ...args.vars } }

    const connect = buildConnect(scenario.target, baseDir, log, args.verbose ?? false)
    const module = args.recipes ? await loadRecipeModule(resolve(args.recipes)) : undefined

    return runScenario(scenario, {
        connect,
        recipes: module?.recipes,
        generators: module?.generators,
        env: args.env ?? process.env,
        log,
    })
}

function buildConnect(
    target: TargetSpec,
    baseDir: string,
    log: (line: string) => void,
    verbose: boolean,
): (user: string) => Promise<TestSession> {
    if (!target.url) throw new Error('target.url is required')
    if (!target.schema) throw new Error('target.schema is required')
    if (!target.publicKey)
        throw new Error('target.publicKey (path to the server RSA public-key PEM) is required')

    const schemaDirs = (Array.isArray(target.schema) ? target.schema : [target.schema]).map(d =>
        resolveFrom(baseDir, d),
    )
    const codec = createCodec(schemaDirs)
    const publicKey = createPublicKey(readFileSync(resolveFrom(baseDir, target.publicKey)))
    const kind = target.transport ?? (target.url.startsWith('tcp:') ? 'tcp' : 'ws')

    return (user: string) => {
        const opts = {
            layer: target.layer,
            initConnection: target.initConnection,
            onInvoke: verbose ? (t: InvokeTrace) => log(traceLines(user, t)) : undefined,
            onUpdate: verbose ? (u: TlObject) => log(updateLines(user, u)) : undefined,
        }
        const transport = kind === 'tcp' ? tcpTransport(...parseTcp(target.url!)) : wsTransport(target.url!)
        return TestSession.fromTransport(transport, publicKey, codec, opts)
    }
}

function parseTcp(url: string): [number, string] {
    const u = new URL(url)
    return [Number(u.port), u.hostname]
}

// Resolve a scenario path: relative to the CWD first (stable wherever the
// scenario file lives), then relative to the scenario file (back-compat).
function resolveFrom(baseDir: string, p: string): string {
    if (isAbsolute(p)) return p
    const fromCwd = resolve(process.cwd(), p)
    if (existsSync(fromCwd)) return fromCwd
    const fromBase = resolve(baseDir, p)
    if (existsSync(fromBase)) return fromBase
    return fromCwd // neither found — surface a clear CWD-relative error
}

// Pretty, scannable trace: a header line + the data indented below it.
function traceLines(user: string, t: InvokeTrace): string {
    const req = `  → [${user}] ${t.method}\n${indent(pretty(t.params))}`
    if (t.error) {
        return `${req}\n  ✗ [${user}] rpc_error ${t.error.code} ${t.error.message}  (${t.durationMs}ms)`
    }
    const tag = resultTag(t.result)
    return `${req}\n  ← [${user}] ${tag}  (${t.durationMs}ms)\n${indent(pretty(t.result))}`
}

function updateLines(user: string, u: TlObject): string {
    return `  ⇐ [${user}] update  ${u._}\n${indent(pretty(u))}`
}

function resultTag(v: unknown): string {
    return v && typeof v === 'object' && '_' in v ? String((v as TlObject)._) : typeof v
}

function indent(s: string): string {
    return s
        .split('\n')
        .map(l => '      ' + l)
        .join('\n')
}

function pretty(v: unknown): string {
    return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2) ?? String(v)
}
