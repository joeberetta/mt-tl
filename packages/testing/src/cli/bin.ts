#!/usr/bin/env node
import { runFromFiles, type RunArgs } from './run.js'
import { formatReport, type ReportFormat } from './report.js'

const USAGE = `mtproto-test — run YAML scenarios against an MTProto server

Usage:
  mtproto-test run <scenario.yaml> [options]

Options:
  --config <file>     Per-stand overlay YAML (overrides target/vars/creds)
  --recipes <file>    JS/TS module exporting auth recipes (for user.auth.recipe)
  --format <fmt>      Report format: pretty (default) | json
  --var <k=v>         Override/define a scenario var (repeatable)
  -v, --verbose       Print the full request/response of every call
  -h, --help          Show this help

Exit code: 0 if every step passed, 1 if any failed, 2 on a setup error.`

async function main(argv: string[]): Promise<number> {
    const [cmd, ...rest] = argv
    if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
        process.stdout.write(USAGE + '\n')
        return cmd ? 0 : 1
    }
    if (cmd !== 'run') {
        process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}\n`)
        return 1
    }

    const { args, format } = parseRunArgs(rest)
    if (!args.scenario) {
        process.stderr.write(`run: missing <scenario.yaml>\n\n${USAGE}\n`)
        return 1
    }

    const report = await runFromFiles(args)
    process.stdout.write(formatReport(report, format) + '\n')
    return report.ok ? 0 : 1
}

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

main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(e => {
        process.stderr.write((e instanceof Error ? (e.stack ?? e.message) : String(e)) + '\n')
        process.exit(2)
    })
