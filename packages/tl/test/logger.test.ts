import { describe, it, expect } from 'vitest'
import { createLogger, noopLogger, type LogLevel } from '../src/logger.js'

/** Capture lines into an array so we can assert on emitted output. */
function capture(opts: Parameters<typeof createLogger>[0] = {}) {
    const lines: string[] = []
    const log = createLogger({ ...opts, write: l => lines.push(l) })
    return { log, lines }
}

describe('createLogger — levels', () => {
    it('gates by threshold (trace < debug < info < warn < error)', () => {
        const { log, lines } = capture({ level: 'info', format: 'json' })
        log.trace('t')
        log.debug('d')
        log.info('i')
        log.warn('w')
        log.error('e')
        const msgs = lines.map(l => JSON.parse(l).msg)
        expect(msgs).toEqual(['i', 'w', 'e'])
    })

    it('trace is the most verbose level (emits everything)', () => {
        const { log, lines } = capture({ level: 'trace', format: 'json' })
        log.trace('t')
        log.info('i')
        expect(lines.map(l => JSON.parse(l).msg)).toEqual(['t', 'i'])
    })

    it('silent drops everything', () => {
        const { log, lines } = capture({ level: 'silent' })
        log.error('nope')
        expect(lines).toEqual([])
    })

    it('isLevelEnabled reflects the threshold', () => {
        const log = createLogger({ level: 'warn' })
        const enabled = (l: LogLevel) => log.isLevelEnabled(l)
        expect([
            enabled('trace'),
            enabled('debug'),
            enabled('info'),
            enabled('warn'),
            enabled('error'),
        ]).toEqual([false, false, false, true, true])
        expect(log.level).toBe('warn')
    })
})

describe('createLogger — formats', () => {
    it('json emits one object per line with time/level/msg + fields', () => {
        const { log, lines } = capture({ level: 'info', format: 'json', name: 'node-1' })
        log.info('rpc', { method: 'help.getConfig', ms: 12 })
        const obj = JSON.parse(lines[0]!)
        expect(obj).toMatchObject({
            level: 'info',
            name: 'node-1',
            msg: 'rpc',
            method: 'help.getConfig',
            ms: 12,
        })
        expect(typeof obj.time).toBe('string')
    })

    it('pretty emits a readable line with key=value fields', () => {
        const { log, lines } = capture({ level: 'info', format: 'pretty' })
        log.info('rpc', { method: 'help.getConfig', ms: 12 })
        expect(lines[0]).toContain('INFO')
        expect(lines[0]).toContain('rpc method=help.getConfig ms=12')
    })

    it('serializes bigint fields to strings', () => {
        const { log, lines } = capture({ level: 'info', format: 'json' })
        log.info('authkey.create', { authKeyId: 123456789012345678901234567890n })
        expect(JSON.parse(lines[0]!).authKeyId).toBe('123456789012345678901234567890')
    })
})

describe('createLogger — error stack toggle', () => {
    const err = new Error('boom')

    it('includes the stack by default in pretty (dev)', () => {
        const { log, lines } = capture({ level: 'error', format: 'pretty' })
        log.error('rpc.fail', { err })
        expect(lines[0]).toContain('boom')
        expect(lines[0]).toContain('stack')
    })

    it('omits the stack by default in json (prod opts in)', () => {
        const { log, lines } = capture({ level: 'error', format: 'json' })
        log.error('rpc.fail', { err })
        const obj = JSON.parse(lines[0]!)
        expect(obj.err).toMatchObject({ name: 'Error', message: 'boom' })
        expect(obj.err.stack).toBeUndefined()
    })

    it('errorStack: true forces the stack on even in json', () => {
        const { log, lines } = capture({ level: 'error', format: 'json', errorStack: true })
        log.error('rpc.fail', { err })
        expect(JSON.parse(lines[0]!).err.stack).toContain('boom')
    })

    it('errorStack: false drops the stack even in pretty', () => {
        const { log, lines } = capture({ level: 'error', format: 'pretty', errorStack: false })
        log.error('rpc.fail', { err })
        expect(lines[0]).not.toContain('stack')
    })
})

describe('createLogger — color', () => {
    it('emits no ANSI codes by default with a custom sink', () => {
        const { log, lines } = capture({ level: 'info', format: 'pretty' })
        log.info('rpc', { method: 'x' })
        expect(lines[0]).not.toContain('\x1b[')
        expect(lines[0]).toContain('rpc method=x')
    })

    it('color: true wraps the level and dims field keys with ANSI', () => {
        const { log, lines } = capture({ level: 'info', format: 'pretty', color: true })
        log.info('rpc', { method: 'x' })
        expect(lines[0]).toContain('\x1b[') // contains ANSI
        expect(lines[0]).toContain('\x1b[32m') // info = green
        expect(lines[0]).toContain('rpc') // msg still present
        expect(lines[0]).toContain('\x1b[2mmethod=') // dimmed key…
        expect(lines[0]).toContain('=\x1b[0mx') // …bright value
    })

    it('json is never colored even with color: true', () => {
        const { log, lines } = capture({ level: 'info', format: 'json', color: true })
        log.info('rpc', { method: 'x' })
        expect(lines[0]).not.toContain('\x1b[')
        expect(() => JSON.parse(lines[0]!)).not.toThrow()
    })
})

describe('createLogger — child', () => {
    it('merges parent bindings into every line and inherits level/format/stack', () => {
        const { log, lines } = capture({ level: 'info', format: 'json', bindings: { nodeId: 'n1' } })
        const child = log.child({ scope: 'ws', conn: 7 })
        child.info('conn.open', { remote: '1.2.3.4' })
        const obj = JSON.parse(lines[0]!)
        expect(obj).toMatchObject({ nodeId: 'n1', scope: 'ws', conn: 7, remote: '1.2.3.4' })
    })

    it('per-call fields override bindings', () => {
        const { log, lines } = capture({ level: 'info', format: 'json', bindings: { scope: 'root' } })
        log.child({ scope: 'child' }).info('x', { scope: 'call' })
        expect(JSON.parse(lines[0]!).scope).toBe('call')
    })
})

describe('noopLogger', () => {
    it('drops everything and returns itself from child', () => {
        expect(noopLogger.isLevelEnabled('error')).toBe(false)
        expect(noopLogger.child({ a: 1 })).toBe(noopLogger)
        // No throw / no output:
        noopLogger.error('ignored', { err: new Error('x') })
    })
})
