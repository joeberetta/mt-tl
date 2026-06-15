import { generateSchemaTs } from '@mt-tl/tl'
import { format, resolveConfig } from 'prettier'

/**
 * Generate `src/generated/schema.ts` from the app's `.tl` schema AND format it
 * with the project's Prettier config — so the committed file matches `yarn
 * format` (no `.prettierignore` needed). Both `gen-types.ts` (writes it) and
 * `gen-types.test.ts` (asserts committed === this) call this, so they can't drift.
 */
export async function generateFormattedSchema(schemaDir: string, outPath: string): Promise<string> {
    const raw = generateSchemaTs(schemaDir)
    const config = await resolveConfig(outPath)
    return format(raw, { ...config, parser: 'typescript' })
}
