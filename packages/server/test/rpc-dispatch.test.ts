import { describe, it, expect } from 'vitest'
import { RpcRegistry, defineRpc, dispatchRpc, AppError, type UpdateEmitter } from '../src/core/index.js'
import type { RpcRequest } from '@mt-tl/tl'

const noopEmitter: UpdateEmitter = { async emit() {}, async emitToAuthKey() {} }
const greeting = 'hi' // closed over by the handler (Style A — no services bag)

const registry = new RpcRegistry().add(
    defineRpc({
        'help.getServerConfig': {
            auth: false,
            handler: async (_params, ctx) => {
                ctx.bindUser('u-777')
                return { _: 'dataJSON', data: greeting }
            },
        },
        'dust.getBalances': async () => {
            throw new AppError(420, 'FLOOD_WAIT_5')
        },
    }),
)

const deps = { updates: noopEmitter }

function req(method: string, subject?: string): RpcRequest {
    return {
        id: '1',
        method,
        params: {},
        context: { sessionId: 's', authKeyId: 'a', apiLayer: 204, subject },
    }
}

describe('dispatchRpc', () => {
    it('returns the result and collected effects', async () => {
        const res = await dispatchRpc(registry, req('help.getServerConfig'), deps)
        expect(res.result).toEqual({ _: 'dataJSON', data: 'hi' })
        expect(res.effects).toEqual([{ type: 'bindUser', subject: 'u-777' }])
    })

    it('gates auth-required methods on anonymous keys', async () => {
        const res = await dispatchRpc(registry, req('dust.getBalances'), deps)
        expect(res.error).toEqual({ code: 401, message: 'AUTH_KEY_UNREGISTERED' })
    })

    it('maps AppError to its code (handler runs once authorized)', async () => {
        const res = await dispatchRpc(registry, req('dust.getBalances', 'u-42'), deps)
        expect(res.error).toEqual({ code: 420, message: 'FLOOD_WAIT_5' })
    })

    it('returns 404 for unknown methods', async () => {
        const res = await dispatchRpc(registry, req('nope.method'), deps)
        expect(res.error).toEqual({ code: 404, message: 'METHOD_NOT_FOUND' })
    })

    it('registers the handlers', () => {
        expect(registry.size).toBe(2)
    })
})
