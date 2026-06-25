import { useContext, useEffect, useMemo, useState } from 'react'
import { Icon } from './icon.js'
import { marked } from 'marked'
import { LayerCtx } from './layer-context.js'
import { computeLayerDiff, computeRangeDiff, type ChangeEntry } from './doc-utils.js'
import type { ApiSpec } from './spec-types.js'

/**
 * Per-layer changelog: an auto-diff of the schema vs the previous layer
 * (added / changed / removed), with an optional authored prose intro
 * (`changelog/<N>.md`, bundled as changelog.json). Like core.telegram.org/api/layers.
 */
export function ChangelogPage({ spec }: { spec: ApiSpec }) {
    const { layer, setLayer } = useContext(LayerCtx)
    const [prose, setProse] = useState<Record<string, string>>({})

    useEffect(() => {
        // optional — absent unless the consumer authored changelog notes
        fetch('./changelog.json')
            .then(r => (r.ok ? r.json() : {}))
            .then((m: Record<string, string>) => setProse(m && typeof m === 'object' ? m : {}))
            .catch(() => {})
    }, [])

    const [wrap, setWrap] = useState(false)
    const diff = useMemo(() => computeLayerDiff(spec, layer), [spec, layer])
    const proseMd = prose[String(layer)]
    const proseHtml = useMemo(() => (proseMd ? (marked.parse(proseMd) as string) : ''), [proseMd])

    return (
        <main className="content" style={{ maxWidth: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span className="badge">changelog</span>
                <h1 style={{ fontSize: 20 }}>Changelog</h1>
                <span className="id">{diff.prev !== undefined ? `layer ${diff.prev} → ${layer}` : `layer ${layer} (first)`}</span>
                <button className={wrap ? 'on' : ''} onClick={() => setWrap(w => !w)} title="wrap long lines" style={{ marginLeft: 'auto', fontSize: 12 }}>
                    <Icon name="text-wrap" /> {wrap ? 'wrap' : 'no wrap'}
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr)', gap: 18, alignItems: 'start' }}>
                <div>
                    <div className="group" style={{ padding: '0 0 6px' }}>layer</div>
                    {[...spec.layers].reverse().map(l => (
                        <div
                            key={l}
                            onClick={() => setLayer(l)}
                            className="lyr-pick"
                            style={{
                                cursor: 'pointer',
                                padding: '5px 10px',
                                borderRadius: 6,
                                fontSize: 13,
                                background: l === layer ? 'var(--accent-bg)' : undefined,
                                color: l === layer ? 'var(--accent)' : 'var(--text2)',
                                fontWeight: l === layer ? 500 : 400,
                            }}
                        >
                            {l}
                            {l === spec.latestLayer ? ' · latest' : ''}
                        </div>
                    ))}
                </div>

                <div>
                    {proseHtml && <div className="prose" dangerouslySetInnerHTML={{ __html: proseHtml }} style={{ marginBottom: 18 }} />}
                    {diff.prev === undefined ? (
                        // earliest frozen layer → nothing to diff; everything would be "added",
                        // which is just the baseline. Point at the full schema instead.
                        <div className="callout">
                            Layer {layer} is the earliest frozen layer — there's no previous layer to diff against, so
                            this is the baseline. <a href={`#/schema?layer=${layer}`}>Browse the full schema at this layer →</a>
                        </div>
                    ) : diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0 ? (
                        <div className="callout">No schema changes between layer {diff.prev} and {layer}.</div>
                    ) : (
                        <div className={'schema-dump' + (wrap ? ' wrap' : '')}>
                            <Section title="added" entries={diff.added} color="var(--ok)" />
                            <Section title="changed" entries={diff.changed} color="var(--accent)" showDetail />
                            <Section title="removed" entries={diff.removed} color="var(--danger)" struck />
                        </div>
                    )}
                </div>
            </div>

            <RangeDiff spec={spec} />
        </main>
    )
}

/** Net diff between any two chosen layers (e.g. 190 → 200) in one view — the
 *  per-layer diff above only compares adjacent layers; this spans an arbitrary range. */
function RangeDiff({ spec }: { spec: ApiSpec }) {
    const layers = spec.layers
    const [from, setFrom] = useState(layers[0]!)
    const [to, setTo] = useState(spec.latestLayer)
    const [wrap, setWrap] = useState(false)
    const diff = useMemo(() => computeRangeDiff(spec, from, to), [spec, from, to])
    const pick = (v: number, set: (n: number) => void, label: string) => (
        <select value={v} onChange={e => set(Number(e.target.value))} aria-label={label}>
            {layers.map(l => (
                <option key={l} value={l}>
                    {l}
                    {l === spec.latestLayer ? ' · latest' : ''}
                </option>
            ))}
        </select>
    )
    const total = diff.added.length + diff.changed.length + diff.removed.length
    return (
        <section style={{ marginTop: 28, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <h2 style={{ fontSize: 17, margin: 0 }}>Diff across layers</h2>
                {pick(from, setFrom, 'from layer')} <span className="muted">→</span> {pick(to, setTo, 'to layer')}
                <span className="id">{total} change{total === 1 ? '' : 's'}</span>
                <button className={wrap ? 'on' : ''} onClick={() => setWrap(w => !w)} title="wrap long lines" style={{ marginLeft: 'auto', fontSize: 12 }}>
                    <Icon name="text-wrap" /> {wrap ? 'wrap' : 'no wrap'}
                </button>
            </div>
            {from === to ? (
                <div className="callout">Pick two different layers to compare.</div>
            ) : total === 0 ? (
                <div className="callout">No schema changes between layer {from} and {to}.</div>
            ) : (
                <div className={'schema-dump' + (wrap ? ' wrap' : '')}>
                    <Section title="added" entries={diff.added} color="var(--ok)" />
                    <Section title="changed" entries={diff.changed} color="var(--accent)" showDetail />
                    <Section title="removed" entries={diff.removed} color="var(--danger)" struck />
                </div>
            )}
        </section>
    )
}

function Section({
    title,
    entries,
    color,
    struck,
    showDetail,
}: {
    title: string
    entries: ChangeEntry[]
    color: string
    struck?: boolean
    showDetail?: boolean
}) {
    if (entries.length === 0) return null
    const line = (e: ChangeEntry) => (
        <a
            key={e.name}
            className="schema-line"
            href={`#/${e.kind}/${e.name}`}
            style={{ color, textDecoration: struck ? 'line-through' : undefined }}
        >
            {e.line}
            {showDetail && e.detail ? `   // ${e.detail}` : ''}
        </a>
    )
    // split each change group by kind so you can tell types from functions
    const ctors = entries.filter(e => e.kind === 'constructor')
    const methods = entries.filter(e => e.kind === 'method')
    return (
        <>
            <div className="changelog-head" style={{ color }}>
                {title} · {entries.length}
            </div>
            {ctors.length > 0 && (
                <>
                    <div className="schema-marker">---types--- ({ctors.length})</div>
                    {ctors.map(line)}
                </>
            )}
            {methods.length > 0 && (
                <>
                    <div className="schema-marker">---functions--- ({methods.length})</div>
                    {methods.map(line)}
                </>
            )}
        </>
    )
}
