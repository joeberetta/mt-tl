import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { freezeLayer } from '../src/tools/freeze-layer.js'

// The protocol/core constructors `parseSchemaDir` injects into every parse.
// They must NOT end up in a business layer snapshot.
const CORE_IDS = ['1cb5c415', 'f35c6d01', '73f1f8dc', '5bb8e511', 'e06046b2', '3072cfa1']

describe('freezeLayer — business-only snapshots', () => {
    it('excludes the protocol/core layer from the frozen snapshot', () => {
        const schemaDir = mkdtempSync(join(tmpdir(), 'freeze-schema-'))
        const outDir = mkdtempSync(join(tmpdir(), 'freeze-out-'))
        try {
            // A minimal business schema — protocol types are NOT declared here, yet
            // parseSchemaDir injects the core ctors. The snapshot must drop them.
            writeFileSync(
                join(schemaDir, 'scheme_demo.tl'),
                'demo.thing#11223344 id:long name:string = demo.Thing;\n' +
                    '---functions---\n' +
                    'demo.getThing#55667788 id:long = demo.Thing;\n',
            )

            const r = freezeLayer(schemaDir, outDir, 999)
            const snap = JSON.parse(readFileSync(r.out, 'utf8')) as {
                constructors: Array<{ id: string; predicate?: string }>
                methods: Array<{ id: string; method?: string }>
            }
            const ids = new Set([...snap.constructors, ...snap.methods].map(e => e.id))

            // Business defs survive; no protocol/core ids leak into json or tl.
            expect(ids.has('11223344')).toBe(true)
            expect(ids.has('55667788')).toBe(true)
            for (const core of CORE_IDS) expect(ids.has(core)).toBe(false)

            const tl = readFileSync(r.tlOut, 'utf8')
            expect(tl).toContain('demo.thing#11223344')
            expect(tl).not.toMatch(/#1cb5c415|#f35c6d01|#73f1f8dc|#5bb8e511|#e06046b2|#3072cfa1/)
        } finally {
            rmSync(schemaDir, { recursive: true, force: true })
            rmSync(outDir, { recursive: true, force: true })
        }
    })
})
