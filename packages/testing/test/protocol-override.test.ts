import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { schemaDir, layersDir } from 'demo-eos-seed-app/schema'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { TlObject } from '@mt-tl/tl'
import type { RpcMethodSpec } from '@mt-tl/server'
import { createTestServer } from '../src/index.js'

type AnyMethods = Record<string, RpcMethodSpec>

// A consumer "protocol layer" override: redeclares initConnection with a CUSTOM
// `tenant_id` field (a distinct id; the codec uses declared ids). The server and
// the test client both load it, so the extra field rides through end-to-end.
const OVERRIDE_TL = `
---functions---

initConnection#a1b2c3d4 {X:Type} flags:# api_id:int device_model:string system_version:string app_version:string system_lang_code:string lang_pack:string lang_code:string tenant_id:flags.2?string query:!X = X;
`

let server: Awaited<ReturnType<typeof createTestServer>>
let hookBody: TlObject | undefined

beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mt-proto-override-'))
    writeFileSync(join(dir, 'protocol.tl'), OVERRIDE_TL)

    server = await createTestServer<AnyMethods>({
        schemaDir,
        schemaLayersDir: layersDir,
        protocolSchemaDir: dir,
        onInitConnection: body => {
            hookBody = body
        },
        register: app => {
            // Echo the custom initConnection field back so we can assert it reached
            // the handler context (ctx.request.initParams).
            app.method('phone.getCallConfig', { auth: false }, async (_p, ctx) => ({
                _: 'dataJSON',
                data: String(ctx.request.initParams?.tenant_id ?? ''),
            }))
        },
    })
})

afterAll(async () => {
    await server.close()
})

describe('protocol schema override', () => {
    it('decodes a custom initConnection field → ctx.request.initParams + onInitConnection', async () => {
        const c = await server.connect({ layer: 204, initConnection: { tenant_id: 'acme' } })
        const res = await c.invoke('phone.getCallConfig')

        expect(res.data).toBe('acme') // reached the handler context
        expect(hookBody?._).toBe('initConnection')
        expect(hookBody?.tenant_id).toBe('acme') // the hook saw the full decoded body
        c.close()
    })
})
