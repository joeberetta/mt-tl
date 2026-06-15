#!/usr/bin/env node
import { writeSchemaTs } from './codegen/gen-types.js'
import { freezeLayer } from './tools/freeze-layer.js'

const USAGE = `mt-tl — TL tooling

Usage:
  mt-tl gen-types <schemaDir> <outFile>
      Generate TypeScript types (RpcMethods + interfaces) from a .tl schema.

  mt-tl freeze <schemaDir> <outDir> <layer>
      Freeze the current schema into a per-layer snapshot (scheme_<layer>.json + .tl).
`

function fail(msg: string): never {
    console.error(msg + '\n\n' + USAGE)
    process.exit(1)
}

const [cmd, ...args] = process.argv.slice(2)

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
        const res = freezeLayer(schemaDir, outDir, layer)
        console.log(
            `Froze layer ${layer}: ${res.constructors} constructors, ${res.methods} methods → ${res.out}`,
        )
        if (res.crcWarnings) console.warn(`  (${res.crcWarnings} CRC warnings)`)
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
