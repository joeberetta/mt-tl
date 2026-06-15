import Ajv from 'ajv'
import { parse } from 'yaml'
import { readFileSync, readdirSync, statSync } from 'node:fs'

export interface LintResult {
    file: string
    ok: boolean
    issues: Array<{ path: string; message: string }>
}

/** Expand paths (files or dirs) to a flat list of `*.yaml`/`*.yml` scenario files. */
export function collectScenarioFiles(paths: string[]): string[] {
    const out: string[] = []
    const walk = (p: string): void => {
        if (statSync(p).isDirectory()) {
            for (const e of readdirSync(p)) walk(`${p}/${e}`)
        } else if (/\.ya?ml$/.test(p)) {
            out.push(p)
        }
    }
    for (const p of paths) walk(p)
    return out
}

/**
 * Validate scenario YAML files against a JSON Schema (from
 * {@link generateScenarioSchema}). Catches structural mistakes + unknown
 * `invoke:` method names. Does NOT resolve `${...}` refs or per-method params.
 */
export function lintScenarios(files: string[], schema: object): LintResult[] {
    const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)
    return files.map(file => {
        let doc: unknown
        try {
            doc = parse(readFileSync(file, 'utf8'))
        } catch (e) {
            return { file, ok: false, issues: [{ path: '/', message: `YAML parse error: ${(e as Error).message}` }] }
        }
        if (validate(doc)) return { file, ok: true, issues: [] }
        const issues = (validate.errors ?? []).map(e => ({ path: e.instancePath || '/', message: e.message ?? 'invalid' }))
        return { file, ok: false, issues }
    })
}
