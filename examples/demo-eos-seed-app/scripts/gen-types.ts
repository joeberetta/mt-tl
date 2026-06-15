import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { generateFormattedSchema } from './gen-schema.js'

// Regenerates `src/generated/schema.ts` from this app's `.tl` schema (formatted
// with Prettier). Run after editing any `schema/*.tl`:  yarn gen:types
const schemaDir = fileURLToPath(new URL('../schema', import.meta.url))
const outPath = fileURLToPath(new URL('../src/generated/schema.ts', import.meta.url))

writeFileSync(outPath, await generateFormattedSchema(schemaDir, outPath))
console.log('Generated (formatted) ->', outPath)
