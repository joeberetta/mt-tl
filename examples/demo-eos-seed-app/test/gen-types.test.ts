import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { schemaDir } from '../src/schema.js'
import { generateFormattedSchema } from '../scripts/gen-schema.js'

// This app owns its `.tl` schema and its generated TS types; the framework only
// ships the codegen tool. Guard that the committed types match the schema — via
// the SAME formatted generation `yarn gen:types` uses, so they can't drift.
const generatedPath = fileURLToPath(new URL('../src/generated/schema.ts', import.meta.url))

describe('src/generated/schema.ts', () => {
    it('is up to date with the schema (run `yarn gen:types` if this fails)', async () => {
        const committed = readFileSync(generatedPath, 'utf-8')
        expect(await generateFormattedSchema(schemaDir, generatedPath)).toBe(committed)
    })

    it('contains the RpcMethods map and a known method', () => {
        const committed = readFileSync(generatedPath, 'utf-8')
        expect(committed).toContain('export interface RpcMethods {')
        expect(committed).toContain("'users.getFullUser': { params: UsersGetFullUserParams; result: UserFull }")
    })
})
