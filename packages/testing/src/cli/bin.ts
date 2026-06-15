#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeSchemaTs } from '@mt-tl/tl'
import { runFromFiles, type RunArgs } from './run.js'
import { formatReport, type ReportFormat } from './report.js'
import { generateScenarioSchema } from './schema.js'
import { collectScenarioFiles, lintScenarios } from './lint.js'

const USAGE = `mtproto-test — run, lint, and schema YAML scenarios for an MTProto server

Usage:
  mtproto-test run <scenario.yaml | dir> [opts] Run one scenario, or every *.yaml in a dir (CI)
  mtproto-test lint <path...> --schema <tl>     Validate scenarios (files or dirs)
  mtproto-test schema --schema <tl>             Emit scenario.schema.json (editor autocomplete)
  mtproto-test types --schema <tl>              Emit RpcMethods .ts (typed invoke in jest/vitest)

run options:
  --config <file>     Per-stand overlay YAML (overrides target/vars/creds)
  --recipes <file>    JS/TS module: auth/step recipes + custom \${...} generators
  --format <fmt>      pretty (default) | json
  --var <k=v>         Override/define a scenario var (repeatable)
  -v, --verbose       Print each call's request/response (and received pushes)

lint/schema/types options:
  --schema <tl>       The app's .tl schema: a dir, or a single .tl file (e.g. a
                      frozen per-layer snapshot → per-layer types)
  --schema-file <f>   (lint) Use a pre-generated scenario.schema.json instead
  --out <file>        Output path (schema → scenario.schema.json, types → mtproto-methods.ts)

  -h, --help          Show this help

Exit code: 0 ok, 1 a scenario failed / lint errors, 2 a setup error.`

async function main(argv: string[]): Promise<number> {
    const [cmd, ...rest] = argv
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
        process.stdout.write(USAGE + '\n')
        return cmd ? 0 : 1
    }
    if (cmd === 'run') return runCmd(rest)
    if (cmd === 'lint') return lintCmd(rest)
    if (cmd === 'schema') return schemaCmd(rest)
    if (cmd === 'types') return typesCmd(rest)
    process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}\n`)
    return 1
}

async function runCmd(argv: string[]): Promise<number> {
    const { args, format } = parseRunArgs(argv)
    if (!args.scenario) {
        process.stderr.write(`run: missing <scenario.yaml | dir>\n\n${USAGE}\n`)
        return 1
    }
    // A file runs that scenario; a DIRECTORY runs every *.yaml under it (for CI).
    const files = collectScenarioFiles([resolve(args.scenario)])
    if (files.length === 0) {
        process.stderr.write(`run: no scenarios found at ${args.scenario}\n`)
        return 2
    }
    const out = (line: string): void => void process.stdout.write(line + '\n')
    const log = format === 'json' ? () => {} : out

    const results: Array<{ file: string; report: Awaited<ReturnType<typeof runFromFiles>> }> = []
    for (const file of files) {
        if (format !== 'json' && files.length > 1) out(`\n=== ${file} ===`)
        results.push({ file, report: await runFromFiles({ ...args, scenario: file, log }) })
    }

    if (format === 'json') {
        const payload = files.length > 1 ? results : results[0]!.report
        process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
    } else {
        for (const r of results) out((files.length > 1 ? '' : '\n') + formatReport(r.report, 'pretty'))
        if (files.length > 1) {
            const passed = results.filter(r => r.report.ok).length
            out(`\n${'─'.repeat(40)}\n${passed === results.length ? '✓' : '✗'} ${passed}/${results.length} scenarios passed`)
        }
    }
    return results.every(r => r.report.ok) ? 0 : 1
}

function schemaCmd(argv: string[]): number {
    const opts = parseFlags(argv)
    if (!opts.schema) {
        process.stderr.write('schema: --schema <tldir> is required\n')
        return 2
    }
    const schema = generateScenarioSchema(resolve(opts.schema))
    const out = resolve(opts.out ?? 'scenario.schema.json')
    writeFileSync(out, JSON.stringify(schema, null, 2) + '\n')
    process.stdout.write(`wrote ${out}\n`)
    return 0
}

function typesCmd(argv: string[]): number {
    const opts = parseFlags(argv)
    if (!opts.schema) {
        process.stderr.write('types: --schema <tldir> is required\n')
        return 2
    }
    // Generates the full TL `.ts` (interfaces + the `RpcMethods` map). Import that
    // map and type a session — `TestSession.open<RpcMethods>(…)` — for an `invoke`
    // with method-name autocomplete + typed params/results in jest/vitest.
    const out = resolve(opts.out ?? 'mtproto-methods.ts')
    writeSchemaTs(resolve(opts.schema), out)
    process.stdout.write(`wrote ${out}\n`)
    return 0
}

function lintCmd(argv: string[]): number {
    const { positionals, opts } = parsePositionalsAndFlags(argv)
    if (positionals.length === 0) {
        process.stderr.write('lint: pass scenario files or directories\n')
        return 2
    }
    let schema: object
    if (opts['schema-file']) {
        schema = JSON.parse(readFileSync(resolve(opts['schema-file']), 'utf8'))
    } else if (opts.schema) {
        schema = generateScenarioSchema(resolve(opts.schema))
    } else {
        process.stderr.write('lint: pass --schema <tldir> or --schema-file <scenario.schema.json>\n')
        return 2
    }
    const files = collectScenarioFiles(positionals.map(p => resolve(p)))
    const results = lintScenarios(files, schema)
    let failed = 0
    for (const r of results) {
        process.stdout.write(`  ${r.ok ? '✓' : '✗'} ${r.file}\n`)
        if (!r.ok) {
            failed++
            for (const i of r.issues) process.stdout.write(`      ${i.path} ${i.message}\n`)
        }
    }
    process.stdout.write(
        failed === 0 ? `\nAll ${results.length} scenario(s) valid.\n` : `\n${failed} of ${results.length} failed.\n`,
    )
    return failed === 0 ? 0 : 1
}

// --- arg parsing ------------------------------------------------------------

function parseRunArgs(argv: string[]): { args: RunArgs; format: ReportFormat } {
    const args: RunArgs = { scenario: '' }
    let format: ReportFormat = 'pretty'
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!
        const next = (): string => {
            const v = argv[++i]
            if (v === undefined) throw new Error(`missing value for ${a}`)
            return v
        }
        switch (a) {
            case '--config':
                args.config = next()
                break
            case '--recipes':
                args.recipes = next()
                break
            case '--format':
                format = next() as ReportFormat
                break
            case '--var': {
                const [k, ...rest] = next().split('=')
                args.vars = { ...(args.vars ?? {}), [k!]: rest.join('=') }
                break
            }
            case '-v':
            case '--verbose':
                args.verbose = true
                break
            default:
                if (a.startsWith('-')) throw new Error(`unknown option: ${a}`)
                args.scenario = a
        }
    }
    return { args, format }
}

function parseFlags(argv: string[]): Record<string, string> {
    return parsePositionalsAndFlags(argv).opts
}

function parsePositionalsAndFlags(argv: string[]): { positionals: string[]; opts: Record<string, string> } {
    const positionals: string[] = []
    const opts: Record<string, string> = {}
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!
        if (a.startsWith('--')) {
            const v = argv[++i]
            if (v === undefined) throw new Error(`missing value for ${a}`)
            opts[a.slice(2)] = v
        } else {
            positionals.push(a)
        }
    }
    return { positionals, opts }
}

main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(e => {
        process.stderr.write((e instanceof Error ? (e.stack ?? e.message) : String(e)) + '\n')
        process.exit(2)
    })
