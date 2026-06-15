import { describe, it, expect } from 'vitest'
import { createServer, definePlugin, defineHook, BadRequestError, type RpcMethodSpec } from '../src/index.js'

// createServer touches config only at listen(); a stub is fine for registration.
const cfg = {} as Parameters<typeof createServer>[0]
const req = (method: string, subject?: string) =>
    ({ method, params: { _: 'x' }, context: { subject } }) as never

describe('createServer', () => {
    it('registers routes via .method (with and without opts)', () => {
        const app = createServer(cfg)
        app.method('a.x', async () => ({ _: 'r' }))
        app.method('a.y', { auth: false }, async () => ({ _: 'r' }))
        expect(app.methods.sort()).toEqual(['a.x', 'a.y'])
    })

    it('runs a plugin via .register, passing deps by value', () => {
        const plugin = definePlugin<Record<string, RpcMethodSpec>, { prefix: string }>((a, { prefix }) => {
            a.method(`${prefix}.ping`, { auth: false }, async () => ({ _: 'pong' }))
        })
        const app = createServer(cfg)
        app.register(plugin, { prefix: 'svc' })
        expect(app.methods).toContain('svc.ping')
    })

    it('inject dispatches a request and returns the envelope', async () => {
        const app = createServer(cfg)
        app.method('echo.ok', { auth: false }, async () => ({ _: 'echo.result', ok: true }))
        const res = await app.inject(req('echo.ok'))
        expect(res).toMatchObject({ result: { _: 'echo.result', ok: true } })
    })

    it('runs pre-handlers before the handler; a throwing hook rejects', async () => {
        const setBalance = defineHook((_p, ctx) => ctx.set('balance', 42))
        const deny = defineHook(() => {
            throw new BadRequestError('NOPE')
        })
        const app = createServer(cfg)
        app.method('m.ok', { auth: false, preHandlers: [setBalance] }, async (_p, ctx) => ({
            _: 'r',
            balance: ctx.get<number>('balance'),
        }))
        app.method('m.deny', { auth: false, preHandlers: [deny] }, async () => ({ _: 'r' }))

        expect(await app.inject(req('m.ok'))).toMatchObject({ result: { balance: 42 } })
        const denied = await app.inject(req('m.deny'))
        expect(denied.error).toMatchObject({ code: 400, message: 'NOPE' })
    })

    it('401s an auth-required method on an anonymous key', async () => {
        const app = createServer(cfg)
        app.method('secure.thing', async () => ({ _: 'r' }))
        expect((await app.inject(req('secure.thing'))).error?.code).toBe(401)
    })
})
