#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { writeSchemaTs } from './codegen/gen-types.js'
import { freezeLayer } from './tools/freeze-layer.js'
import { buildApiSpec } from './spec.js'

const USAGE = `mt-tl — TL tooling

Usage:
  mt-tl gen-types <schemaDir> <outFile>
      Generate TypeScript types (RpcMethods + interfaces) from a .tl schema.

  mt-tl freeze <schemaDir> <outDir> <layer> [--prefix <p>]
      Freeze the current schema into a per-layer snapshot (<prefix><layer>.json + .tl).
      --prefix sets the snapshot filename prefix (default "scheme_").

  mt-tl spec <layersDir> <outFile> [--prefix <p>]
      Build a layer-aware API spec (api.json) from the frozen layer snapshots —
      the input @mt-tl/studio renders into an interactive doc + playground.
      --prefix must match the prefix the snapshots were frozen with (default "scheme_").
`

function fail(msg: string): never {
    console.error(msg + '\n\n' + USAGE)
    process.exit(1)
}

// Pull `--prefix <value>` out of argv (mutating it) so the rest can be parsed
// positionally. Returns undefined when the flag is absent → callee default applies.
const argv = process.argv.slice(2)
function takeFlag(name: string): string | undefined {
    const i = argv.indexOf('--' + name)
    if (i < 0) return undefined
    const [v] = argv.splice(i, 2).slice(1)
    return v
}
const prefix = takeFlag('prefix')

const [cmd, ...args] = argv

switch (cmd) {
    case 'gen-types': {
        const [schemaDir, outFile] = args
        if (!schemaDir || !outFile) fail('gen-types requires <schemaDir> <outFile>')
        writeSchemaTs(schemaDir, outFile)
        break
    }
    case 'freeze': {
        const [schemaDir, outDir, layerStr] = args
        if (!schemaDir || !outDir || !layerStr) fail('freeze requires <schemaDir> <outDir> <layer>')
        const layer = Number(layerStr)
        if (!Number.isInteger(layer)) fail(`freeze: <layer> must be an integer, got "${layerStr}"`)
        const res = freezeLayer(schemaDir, outDir, layer, prefix)
        console.log(
            `Froze layer ${layer}: ${res.constructors} constructors, ${res.methods} methods → ${res.out}`,
        )
        if (res.crcWarnings) console.warn(`  (${res.crcWarnings} CRC warnings)`)
        break
    }
    case 'spec': {
        const [layersDir, outFile] = args
        if (!layersDir || !outFile) fail('spec requires <layersDir> <outFile>')
        const spec = buildApiSpec(layersDir, prefix)
        writeFileSync(outFile, JSON.stringify(spec, null, 2))
        console.log(
            `Built spec: ${Object.keys(spec.methods).length} methods, ` +
                `${Object.keys(spec.constructors).length} constructors, ` +
                `${Object.keys(spec.types).length} types across layers ` +
                `${spec.layers.join(', ') || '(none)'} → ${outFile}`,
        )
        break
    }
    case undefined:
    case '-h':
    case '--help':
        console.log(USAGE)
        break
    default:
        fail(`unknown command: ${cmd}`)
}
