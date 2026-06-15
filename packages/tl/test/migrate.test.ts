import { describe, it, expect } from 'vitest'
import { MigrationRegistry } from '../src/migrate.js'

// The real example: defi.withdraw across layers 105 / 113 / 173.
//   105: flags, symbol:string, risk_level, project:flags.0?defi.Project
//   113: project_id:string, risk_level, symbol:string
//   173: flags, project_id:string, risk_level, symbol:flags.0?string  (canonical)
function ladder(): MigrationRegistry {
    return new MigrationRegistry().register('defi.withdraw', [
        {
            since: 105,
            up: p => ({
                _: 'defi.withdraw',
                project_id: (p.project as { id?: string } | undefined)?.id ?? '',
                risk_level: p.risk_level,
                symbol: p.symbol,
            }),
            down: c => ({
                _: 'defi.withdraw',
                symbol: c.symbol,
                risk_level: c.risk_level,
                project: c.project_id ? { _: 'defi.project', id: c.project_id } : undefined,
            }),
        },
        {
            since: 113,
            up: p => ({
                _: 'defi.withdraw',
                project_id: p.project_id,
                risk_level: p.risk_level,
                symbol: p.symbol,
            }),
            down: c => ({
                _: 'defi.withdraw',
                project_id: c.project_id,
                risk_level: c.risk_level,
                symbol: c.symbol ?? '',
            }),
        },
        { since: 173 },
    ])
}

const risk = { _: 'defi.riskLevelLow' }

describe('MigrationRegistry — up (client layer -> canonical)', () => {
    const reg = ladder()

    it('chains both rungs from the oldest version', () => {
        const v105 = {
            _: 'defi.withdraw',
            symbol: 'BTC',
            risk_level: risk,
            project: { _: 'defi.project', id: 'p1' },
        }
        expect(reg.up(v105, 105)).toEqual({
            _: 'defi.withdraw',
            project_id: 'p1',
            risk_level: risk,
            symbol: 'BTC',
        })
    })

    it('chains one rung from a middle version', () => {
        const v113 = { _: 'defi.withdraw', project_id: 'p2', risk_level: risk, symbol: 'ETH' }
        expect(reg.up(v113, 113)).toEqual({
            _: 'defi.withdraw',
            project_id: 'p2',
            risk_level: risk,
            symbol: 'ETH',
        })
    })

    it('is identity at the canonical layer', () => {
        const v173 = { _: 'defi.withdraw', project_id: 'p3', risk_level: risk, symbol: 'SOL' }
        expect(reg.up(v173, 173)).toEqual(v173)
        expect(reg.up(v173, 250)).toEqual(v173) // future layer floors to canonical
    })
})

describe('MigrationRegistry — down (canonical -> client layer)', () => {
    const reg = ladder()
    const canonical = { _: 'defi.withdraw', project_id: 'p1', risk_level: risk, symbol: 'BTC' }

    it('chains down to the oldest version (lossy reconstruct allowed)', () => {
        expect(reg.down(canonical, 105)).toEqual({
            _: 'defi.withdraw',
            symbol: 'BTC',
            risk_level: risk,
            project: { _: 'defi.project', id: 'p1' },
        })
    })

    it('chains down one rung to the middle version', () => {
        expect(reg.down(canonical, 113)).toEqual({
            _: 'defi.withdraw',
            project_id: 'p1',
            risk_level: risk,
            symbol: 'BTC',
        })
    })

    it('is identity at the canonical layer', () => {
        expect(reg.down(canonical, 173)).toEqual(canonical)
    })
})

describe('MigrationRegistry — recursion & no-op', () => {
    it('migrates a nested predicate inside a container', () => {
        const reg = ladder()
        const wrapped = {
            _: 'wrapper',
            inner: {
                _: 'defi.withdraw',
                symbol: 'BTC',
                risk_level: risk,
                project: { _: 'defi.project', id: 'p1' },
            },
            items: [{ _: 'defi.withdraw', symbol: 'X', risk_level: risk }],
        }
        const out = reg.up(wrapped, 105) as typeof wrapped
        expect(out.inner).toEqual({ _: 'defi.withdraw', project_id: 'p1', risk_level: risk, symbol: 'BTC' })
        expect(out.items[0]).toEqual({ _: 'defi.withdraw', project_id: '', risk_level: risk, symbol: 'X' })
    })

    it('leaves predicates without a ladder untouched', () => {
        const reg = ladder()
        const v = { _: 'dust.getConfig', x: 1 }
        expect(reg.up(v, 100)).toEqual(v)
        expect(reg.down(v, 100)).toEqual(v)
    })
})
