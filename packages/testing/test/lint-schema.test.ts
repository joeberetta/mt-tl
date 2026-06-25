import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schemaDir } from 'demo-eos-seed-app/schema'
import { describe, it, expect } from 'vitest'
import { generateScenarioSchema, lintScenarios, collectScenarioFiles } from '../src/cli/index.js'

describe('scenario schema + lint (shipped in the package)', () => {
    const schema = generateScenarioSchema(schemaDir) as {
        definitions: { method: { enum: string[] } }
    }

    it('generates a schema with a TL method enum', () => {
        expect(schema.definitions.method.enum).toContain('crypto.sendCode')
        expect(schema.definitions.method.enum.length).toBeGreaterThan(100)
    })

    it('lints valid scenarios and flags bad ones (unknown method + stray field)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mtproto-lint-'))
        try {
            writeFileSync(join(dir, 'good.yaml'), 'target: { url: ws://x }\nsteps:\n  - { invoke: crypto.sendCode }\n')
            writeFileSync(
                join(dir, 'bad.yaml'),
                'target: { url: ws://x }\nsteps:\n  - { invoke: crypto.nope, paramz: {} }\n',
            )
            // a non-blocking expectUpdate (since 0.1.8) must lint clean, not as a stray field
            writeFileSync(
                join(dir, 'nonblocking.yaml'),
                'target: { url: ws://x }\nsteps:\n  - { expectUpdate: { _: updateShort }, nonBlocking: true, timeoutMs: 5000 }\n',
            )
            const results = lintScenarios(collectScenarioFiles([dir]), schema)
            const byName = (n: string) => results.find(r => r.file.endsWith(n))!
            expect(byName('good.yaml').ok).toBe(true)
            expect(byName('nonblocking.yaml').ok).toBe(true)
            expect(byName('bad.yaml').ok).toBe(false)
            expect(byName('bad.yaml').issues.length).toBeGreaterThan(0)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
