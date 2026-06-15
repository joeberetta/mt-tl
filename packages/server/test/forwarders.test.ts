import { describe, it, expect } from 'vitest'
import { createLogger, type RpcRequest } from '@mt-tl/tl'
import { RpcRegistry, defineRpc, dispatchRpc, type UpdateEmitter } from '../src/core/index.js'
import { InProcessForwarder } from '../src/dispatch/forwarders/in-process.js'
import { PrintForwarder } from '../src/dispatch/forwarders/print.js'

// Forwarders are the bridge from a decoded business method to its handler. The
// framework is in-process, so only two implementations exist: InProcessForwarder
// (prod + tests) and PrintForwarder (dev fallback). The historical HTTP/RabbitMQ
// remote runners were removed — see docs/guide/forwarders.md.
// (This file can be renamed to `forwarders.test.ts`.)

const noopEmitter: UpdateEmitter = { async emit() {}, async emitToAuthKey() {} }
const config = 'cfg' // closed over by the handler (Style A — no services bag)

const registry = new RpcRegistry().add(
    defineRpc({
        'help.getServerConfig': { auth: false, handler: async () => ({ _: 'dataJSON', data: config }) },
    }),
)
const deps = { updates: noopEmitter }

const request: RpcRequest = {
    id: '7',
    method: 'help.getServerConfig',
    params: {},
    context: { sessionId: 's', authKeyId: 'a', apiLayer: 204 },
}

describe('InProcessForwarder', () => {
    it('forwards a request to the wrapped handler (dispatchRpc)', async () => {
        const forwarder = new InProcessForwarder(req => dispatchRpc(registry, req, deps))
        const res = await forwarder.forward(request)
        expect(res.result).toEqual({ _: 'dataJSON', data: 'cfg' })
    })
})

describe('PrintForwarder', () => {
    it('logs the request envelope (rpc.print) and returns NOT_IMPLEMENTED', async () => {
        const lines: string[] = []
        const forwarder = new PrintForwarder(
            createLogger({ level: 'info', format: 'json', write: l => lines.push(l) }),
        )

        const res = await forwarder.forward(request)

        expect(res.error).toEqual({ code: 501, message: 'NOT_IMPLEMENTED' })
        const printed = lines.join('\n')
        expect(printed).toContain('rpc.print')
        expect(printed).toContain('help.getServerConfig')
    })
})
