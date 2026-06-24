import { useContext, useMemo, useState, type CSSProperties } from 'react'
import { Icon } from './icon.js'
import { LayerCtx } from './layer-context.js'
import { tlLine } from './doc-utils.js'
import { highlightTlLine } from './tl-highlight.js'
import type { ApiSpec, SpecSymbol } from './spec-types.js'

type Filter = 'all' | 'methods' | 'constructors' | 'types'
interface Row {
    name: string
    kind: 'method' | 'constructor'
    line: string
    n: number // 1-based line number, absolute within the layer's full schema
}

const nsOf = (name: string): string => (name.includes('.') ? name.slice(0, name.indexOf('.')) : 'core')

function initialFrom(): { filter: Filter; q: string } {
    const qs = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
    const f = qs.get('filter')
    const filter: Filter = f === 'methods' || f === 'constructors' || f === 'types' ? f : 'all'
    return { filter, q: qs.get('ns') ?? '' }
}

/**
 * The full `.tl` schema of the selected layer, like core.telegram.org/schema:
 * a continuous block split into a `---types---` (constructor) section and a
 * `---functions---` (method) section, grouped by namespace (blank line between
 * groups). Kind filter, prefix/substring line filter, wrap toggle, copy/download.
 */
export function SchemaPage({ spec }: { spec: ApiSpec }) {
    const { layer } = useContext(LayerCtx)
    const init = useMemo(initialFrom, [])
    const [filter, setFilter] = useState<Filter>(init.filter)
    const [q, setQ] = useState(init.q)
    const [prefix, setPrefix] = useState(false) // match from the start of the line
    const [wrap, setWrap] = useState(false) // default: one line + horizontal scroll

    const ql = q.trim().toLowerCase()
    const matches = (line: string): boolean => !ql || (prefix ? line.toLowerCase().startsWith(ql) : line.toLowerCase().includes(ql))

    // every definition of a kind at this layer, grouped by namespace, in display order.
    // built UNFILTERED so line numbers can stay absolute.
    const allGroupsByKind = (kind: 'method' | 'constructor'): [string, Row[]][] => {
        const src = kind === 'method' ? spec.methods : spec.constructors
        const byNs = new Map<string, Row[]>()
        for (const s of Object.values(src) as SpecSymbol[]) {
            const shape = s.byLayer[layer]
            if (!shape) continue
            const row: Row = { name: s.name, kind, line: tlLine(s, shape), n: 0 }
            const ns = nsOf(s.name)
            ;(byNs.get(ns) ?? byNs.set(ns, []).get(ns)!).push(row)
        }
        return [...byNs.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    }

    // Number every line 1..N across the whole layer file — types section first, then
    // functions — matching the on-screen order and a real `.tl` dump. Computed once per
    // (spec, layer): a definition keeps its number no matter the search box or kind filter,
    // so a filtered view still shows where each line sits in the full schema.
    const { ctorsNum, methodsNum, total } = useMemo(() => {
        let n = 0
        const number = (groups: [string, Row[]][]): [string, Row[]][] =>
            groups.map(([ns, rows]) => [ns, rows.map(r => ({ ...r, n: ++n }))] as [string, Row[]])
        return { ctorsNum: number(allGroupsByKind('constructor')), methodsNum: number(allGroupsByKind('method')), total: n }
    }, [spec, layer])

    // narrow the numbered groups to the current search, dropping now-empty namespaces
    const applyFilter = (groups: [string, Row[]][]): [string, Row[]][] =>
        groups.map(([ns, rows]) => [ns, rows.filter(r => matches(r.line))] as [string, Row[]]).filter(([, rows]) => rows.length > 0)

    const ctors = useMemo(() => (filter === 'all' || filter === 'constructors' ? applyFilter(ctorsNum) : []), [ctorsNum, filter, ql, prefix])
    const methods = useMemo(() => (filter === 'all' || filter === 'methods' ? applyFilter(methodsNum) : []), [methodsNum, filter, ql, prefix])

    const typeGroups = useMemo(() => {
        if (filter !== 'types') return []
        const names = Object.values(spec.types)
            .filter(t => layer >= t.sinceLayer && layer <= t.lastLayer)
            .map(t => t.name)
            .filter(n => (prefix ? n.toLowerCase().startsWith(ql) : n.toLowerCase().includes(ql)))
        const byNs = new Map<string, string[]>()
        for (const n of names) (byNs.get(nsOf(n)) ?? byNs.set(nsOf(n), []).get(nsOf(n))!).push(n)
        return [...byNs.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    }, [spec, layer, filter, ql, prefix])

    const groupsText = (g: [string, Row[]][]): string => g.map(([, rows]) => rows.map(r => r.line).join('\n')).join('\n\n')
    const rawText = useMemo(() => {
        const parts: string[] = []
        if (ctors.length) parts.push('---types---', groupsText(ctors))
        if (methods.length) parts.push('---functions---', groupsText(methods))
        return parts.join('\n')
    }, [ctors, methods])
    const count =
        filter === 'types'
            ? typeGroups.reduce((a, [, n]) => a + n.length, 0)
            : ctors.reduce((a, [, r]) => a + r.length, 0) + methods.reduce((a, [, r]) => a + r.length, 0)

    const download = (): void => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([rawText], { type: 'text/plain' }))
        a.download = `schema_${layer}.tl`
        a.click()
        URL.revokeObjectURL(a.href)
    }

    const section = (marker: string, g: [string, Row[]][]) => (
        <>
            <div className="schema-marker">{marker}</div>
            {g.map(([ns, rows], gi) => (
                <div key={ns} style={{ marginTop: gi === 0 ? 0 : '0.9em' }}>
                    {rows.map(r => (
                        <a key={r.name} className="schema-line" href={`#/${r.kind}/${r.name}`}>
                            <span className="ln" aria-hidden="true">{r.n}</span>
                            <span className="schema-code">{highlightTlLine(r.line)}</span>
                        </a>
                    ))}
                </div>
            ))}
        </>
    )

    return (
        <main className="content" style={{ maxWidth: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <span className="badge">schema</span>
                <h1 style={{ fontSize: 20 }}>Schema</h1>
                <span className="id">layer {layer} · {count}</span>
                {filter !== 'types' && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                        <button onClick={() => void navigator.clipboard?.writeText(rawText)}>
                            <Icon name="copy" /> copy
                        </button>
                        <button onClick={download}>
                            <Icon name="download" /> .tl
                        </button>
                    </span>
                )}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="seg">
                    {(['all', 'methods', 'constructors', 'types'] as Filter[]).map(f => (
                        <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                            {f}
                        </button>
                    ))}
                </div>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="filter…" className="mono" style={{ width: 200, fontSize: 12, marginLeft: 8 }} />
                <label className="inline muted" style={{ fontSize: 12 }}>
                    <input type="checkbox" checked={prefix} onChange={e => setPrefix(e.target.checked)} /> starts with
                </label>
                {filter !== 'types' && (
                    <button className={wrap ? 'on' : ''} onClick={() => setWrap(w => !w)} title="wrap long lines" style={{ fontSize: 12 }}>
                        <Icon name="text-wrap" /> {wrap ? 'wrap' : 'no wrap'}
                    </button>
                )}
            </div>

            {filter === 'types' ? (
                typeGroups.length === 0 ? (
                    <div className="callout">No types match.</div>
                ) : (
                    typeGroups.map(([ns, names]) => (
                        <div key={ns} style={{ marginBottom: 14 }}>
                            <div className="nsh">{ns}</div>
                            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
                                {names.map(n => (
                                    <a key={n} className="card mono" href={`#/type/${n}`} style={{ fontSize: 12, wordBreak: 'break-word' }}>
                                        {n}
                                    </a>
                                ))}
                            </div>
                        </div>
                    ))
                )
            ) : ctors.length === 0 && methods.length === 0 ? (
                <div className="callout">No definitions match.</div>
            ) : (
                <div className={'schema-dump numbered' + (wrap ? ' wrap' : '')} style={{ '--ln-w': `${String(total).length}ch` } as CSSProperties}>
                    {ctors.length > 0 && section('---types---', ctors)}
                    {methods.length > 0 && section('---functions---', methods)}
                </div>
            )}
        </main>
    )
}
