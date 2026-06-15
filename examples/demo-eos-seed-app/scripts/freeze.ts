import { fileURLToPath } from 'node:url'
import { freezeLayer } from '@mt-tl/tl'

// Freezes this app's current `.tl` into a per-layer snapshot used by the gateway
// to encode for clients on that layer.  Run when you ship a layer:  yarn freeze 205
const layer = Number(process.argv[2])
if (!Number.isInteger(layer) || layer <= 0) {
    console.error('usage: yarn freeze <layer>   (e.g. yarn freeze 205)')
    process.exit(1)
}

const r = freezeLayer(
    fileURLToPath(new URL('../schema', import.meta.url)),
    fileURLToPath(new URL('../schema/layers', import.meta.url)),
    layer,
)
console.log(
    `Froze layer ${layer}: ${r.constructors} constructors, ${r.methods} methods` +
        `\n  → ${r.out}\n  → ${r.tlOut} (readable mirror)` +
        (r.crcWarnings ? `\n  (${r.crcWarnings} crc warnings — benign; see docs)` : ''),
)
