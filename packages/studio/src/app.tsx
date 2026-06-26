import { Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icon.js'
import { marked } from 'marked'
import { Builder } from './builder.js'
import { SessionProvider, ConnectionBar } from './session.js'
import { RequestRunner } from './try-it.js'
import { RecipesPage } from './recipes-page.js'
import { ListenPage } from './listen-page.js'
import { SchemaPage } from './schema-page.js'
import { ChangelogPage } from './changelog-page.js'
import { LayerCtx } from './layer-context.js'
import { loadBuiltinRecipes } from './recipes.js'
import { tlLine, typeUsage, paramDiff, type UsageRef } from './doc-utils.js'
import { shapeAt, latestShape } from './spec-access.js'
import { useDoc } from './doc-fetch.js'
import { highlightTlLine } from './tl-highlight.js'
import type { ApiSpec, SpecSymbol, SpecType, SpecShape, SpecParam, Scenario } from './spec-types.js'

/** Folder prefix of a guide slug (e.g. "auth/login" → "auth"; "intro" → "") (B10). */
const folderOf = (slug: string): string => (slug.includes('/') ? slug.slice(0, slug.lastIndexOf('/')) : '')
const leafOf = (slug: string): string => (slug.includes('/') ? slug.slice(slug.lastIndexOf('/') + 1) : slug)

function useHash(): string {
    const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/')
    useEffect(() => {
        const on = () => setHash(window.location.hash.slice(1) || '/')
        window.addEventListener('hashchange', on)
        return () => window.removeEventListener('hashchange', on)
    }, [])
    return hash
}

export function App() {
    const [spec, setSpec] = useState<ApiSpec | null>(null)
    const [scenarios, setScenarios] = useState<Scenario[]>([])
    // Names that have an authored description (descriptions/index.json) — the body
    // of each is fetched lazily on its symbol page. Just a presence set here.
    const [describedNames, setDescribedNames] = useState<Set<string>>(new Set())
    const [err, setErr] = useState<string>()
    const [layer, setLayerState] = useState(0)
    const route = useHash()
    // Off-canvas nav drawer (mobile only — CSS keeps it hidden ≥760px). Closes on
    // any navigation so tapping a symbol slides it away.
    const [navOpen, setNavOpen] = useState(false)
    useEffect(() => setNavOpen(false), [route])

    // Layer lives in the hash query (`?layer=N`) so views are shareable (B11 #1).
    // replaceState avoids history spam + doesn't fire hashchange (no loop).
    const setLayer = (n: number): void => {
        setLayerState(n)
        const [p, q] = (window.location.hash.slice(1) || '/').split('?')
        const params = new URLSearchParams(q ?? '')
        params.set('layer', String(n))
        history.replaceState(null, '', '#' + p + '?' + params.toString())
    }
    // Adopt ?layer on back/forward or a shared link (nav links drop it → keep state).
    useEffect(() => {
        if (!spec) return
        const ul = Number(new URLSearchParams(route.split('?')[1] ?? '').get('layer'))
        if (ul && spec.layers.includes(ul) && ul !== layer) setLayerState(ul)
    }, [route, spec, layer])

    useEffect(() => {
        // Load built-in recipes (if any bundled) before the UI renders, so the connbar /
        // builder show them. api.json gates the UI, so awaiting both is enough.
        Promise.all([
            fetch('./api.json').then(r => (r.ok ? r.json() : Promise.reject(new Error('api.json ' + r.status)))),
            loadBuiltinRecipes(),
        ])
            .then(([s]: [ApiSpec, void]) => {
                setSpec(s)
                const ul = Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('layer'))
                setLayerState(ul && s.layers.includes(ul) ? ul : s.latestLayer)
            })
            .catch(e => setErr(String(e)))
        // Scenarios are optional — absent for a schema with no guides authored. Only
        // the lightweight index (slug/title/interactive) loads up front; each guide's
        // Markdown body is fetched on open (ScenarioPage → useDoc).
        fetch('./scenarios/index.json')
            .then(r => (r.ok ? r.json() : []))
            .then((s: Scenario[]) => setScenarios(Array.isArray(s) ? s : []))
            .catch(() => {})
        // Per-symbol descriptions (authored MD, bundled by `--descriptions`) — optional.
        // Index is just the names that have a doc; each .md is fetched on its page.
        fetch('./descriptions/index.json')
            .then(r => (r.ok ? r.json() : []))
            .then((names: string[]) => setDescribedNames(new Set(Array.isArray(names) ? names : [])))
            .catch(() => {})
    }, [])

    if (err) return <main className="content">Failed to load api.json — {err}</main>
    if (!spec) return <main className="content">Loading…</main>

    return (
        <SessionProvider>
            <LayerCtx.Provider value={{ layer, setLayer }}>
                <div className={'layout' + (navOpen ? ' nav-open' : '')}>
                    <TopBar spec={spec} onToggleNav={() => setNavOpen(o => !o)} />
                    <ConnectionBar layer={layer} route={route} />
                    <SideNav spec={spec} scenarios={scenarios} route={route} />
                    <Page spec={spec} scenarios={scenarios} route={route} describedNames={describedNames} />
                    <div className="nav-overlay" onClick={() => setNavOpen(false)} aria-hidden="true" />
                </div>
                <CommandPalette spec={spec} scenarios={scenarios} />
            </LayerCtx.Provider>
        </SessionProvider>
    )
}

interface CmdItem {
    label: string
    sub: string
    href: string
}

/** Cmd/Ctrl-K fuzzy palette over methods/types/constructors/guides/pages (B11 #4). */
function CommandPalette({ spec, scenarios }: { spec: ApiSpec; scenarios: Scenario[] }) {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [sel, setSel] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)

    const items = useMemo<CmdItem[]>(() => {
        const out: CmdItem[] = [
            { label: 'Schema', sub: 'page', href: '#/schema' },
            { label: 'Changelog', sub: 'page', href: '#/changelog' },
            { label: 'New scenario', sub: 'tool', href: '#/builder' },
            { label: 'Auth recipes', sub: 'tool', href: '#/recipes' },
            { label: 'Listen updates', sub: 'tool', href: '#/listen' },
        ]
        for (const s of scenarios) out.push({ label: s.title, sub: 'guide', href: `#/scenario/${s.slug}` })
        for (const m of Object.values(spec.methods)) out.push({ label: m.name, sub: 'method', href: `#/method/${m.name}` })
        for (const c of Object.values(spec.constructors)) out.push({ label: c.name, sub: 'constructor', href: `#/constructor/${c.name}` })
        for (const t of Object.values(spec.types)) out.push({ label: t.name, sub: 'type', href: `#/type/${t.name}` })
        return out
    }, [spec, scenarios])

    const results = useMemo(() => {
        const ql = query.trim().toLowerCase()
        return (ql ? items.filter(i => i.label.toLowerCase().includes(ql)) : items).slice(0, 40)
    }, [items, query])

    useEffect(() => {
        const on = (e: KeyboardEvent): void => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault()
                setOpen(o => !o)
                setQuery('')
                setSel(0)
            } else if (open && e.key === 'Escape') {
                setOpen(false)
            } else if (open && e.key === 'ArrowDown') {
                e.preventDefault()
                setSel(s => Math.min(s + 1, results.length - 1))
            } else if (open && e.key === 'ArrowUp') {
                e.preventDefault()
                setSel(s => Math.max(s - 1, 0))
            } else if (open && e.key === 'Enter') {
                const r = results[sel]
                if (r) {
                    window.location.hash = r.href
                    setOpen(false)
                }
            }
        }
        window.addEventListener('keydown', on)
        return () => window.removeEventListener('keydown', on)
    }, [open, results, sel])

    useEffect(() => {
        if (open) inputRef.current?.focus()
    }, [open])
    useEffect(() => setSel(0), [query])
    useEffect(() => {
        const opener = (): void => {
            setOpen(true)
            setQuery('')
            setSel(0)
        }
        window.addEventListener('open-cmdk', opener)
        return () => window.removeEventListener('open-cmdk', opener)
    }, [])

    if (!open) return null
    return (
        <div className="cmdk-backdrop" onClick={() => setOpen(false)}>
            <div className="cmdk" onClick={e => e.stopPropagation()}>
                <input
                    ref={inputRef}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Jump to a method, type, guide…"
                    aria-label="command palette"
                />
                <div className="cmdk-list">
                    {results.length === 0 && <div className="cmdk-empty">no matches</div>}
                    {results.map((r, i) => (
                        <Fragment key={r.href}>
                            {(i === 0 || results[i - 1]!.sub !== r.sub) && <div className="cmdk-group">{r.sub}s</div>}
                            <a
                                href={r.href}
                                className={'cmdk-item' + (i === sel ? ' on' : '')}
                                onClick={() => setOpen(false)}
                                onMouseEnter={() => setSel(i)}
                            >
                                <span className="mono">{r.label}</span>
                            </a>
                        </Fragment>
                    ))}
                </div>
            </div>
        </div>
    )
}

function TopBar({ spec, onToggleNav }: { spec: ApiSpec; onToggleNav: () => void }) {
    const { layer, setLayer } = useContext(LayerCtx)
    return (
        <div className="topbar">
            <button className="nav-toggle iconbtn" onClick={onToggleNav} aria-label="open navigation" title="menu">
                <Icon name="menu" />
            </button>
            <a href="#/" className="brand">
                MTProto API · <span className="muted">mt-tl studio</span>
            </a>
            <button className="cmdk-hint" onClick={() => window.dispatchEvent(new Event('open-cmdk'))} title="search (⌘K)">
                <Icon name="search" /> search <span className="kbd">⌘K</span>
            </button>
            <label className="layer-select">
                layer
                <select value={layer} onChange={e => setLayer(Number(e.target.value))}>
                    {[...spec.layers].reverse().map(l => (
                        <option key={l} value={l}>
                            {l}
                            {l === spec.latestLayer ? ' · latest' : ''}
                        </option>
                    ))}
                </select>
            </label>
        </div>
    )
}

// v2 semantics: stores the group keys whose open/closed state is FLIPPED from the
// default. Method groups (`m:<ns>`) and the `types` group default to COLLAPSED — a big
// schema has dozens of namespaces and hundreds of types; tools/reference/guides default
// to expanded.
const NAV_LS = 'mt-tl-studio.navState'
const defaultOpen = (key: string): boolean => !key.startsWith('m:') && key !== 'types'

function SideNav({ spec, scenarios, route }: { spec: ApiSpec; scenarios: Scenario[]; route: string }) {
    // Reflects the SELECTED layer's surface (symbols not present at that layer are
    // hidden); a search filters by name, groups collapse (persisted), "/" focuses search.
    const { layer } = useContext(LayerCtx)
    const [q, setQ] = useState('')
    const [flipped, setFlipped] = useState<Set<string>>(() => {
        try {
            return new Set(JSON.parse(localStorage.getItem(NAV_LS) ?? '[]') as string[])
        } catch {
            return new Set()
        }
    })
    const searchRef = useRef<HTMLInputElement>(null)
    useEffect(() => {
        const on = (e: KeyboardEvent): void => {
            const tag = document.activeElement?.tagName ?? ''
            if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
                e.preventDefault()
                searchRef.current?.focus()
            }
        }
        window.addEventListener('keydown', on)
        return () => window.removeEventListener('keydown', on)
    }, [])

    const ql = q.trim().toLowerCase()
    const forceOpen = ql.length > 0
    const match = (s: string): boolean => !ql || s.toLowerCase().includes(ql)
    const toggle = (key: string): void =>
        setFlipped(c => {
            const n = new Set(c)
            n.has(key) ? n.delete(key) : n.add(key)
            try {
                localStorage.setItem(NAV_LS, JSON.stringify([...n]))
            } catch {
                /* ignore */
            }
            return n
        })

    const methodGroups = useMemo(
        () => groupByNamespace(Object.values(spec.methods).filter(s => shapeAt(s, layer) && match(s.name))),
        [spec, layer, ql],
    )
    const types = useMemo(
        () =>
            Object.values(spec.types)
                .filter(t => layer >= t.sinceLayer && layer <= t.lastLayer && match(t.name))
                .sort((a, b) => a.name.localeCompare(b.name)),
        [spec, layer, ql],
    )
    const guides = scenarios.filter(s => match(s.title) || match(s.slug))
    const guideGroups = useMemo(() => {
        const m = new Map<string, Scenario[]>()
        for (const s of guides) {
            const f = folderOf(s.slug)
            ;(m.get(f) ?? m.set(f, []).get(f)!).push(s)
        }
        return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scenarios, ql])

    const grp = (key: string, title: string, items: React.ReactNode, count?: number): React.ReactNode => {
        const open = forceOpen || (flipped.has(key) ? !defaultOpen(key) : defaultOpen(key))
        return (
            <div className="navgroup" key={key}>
                <div className="group" onClick={() => !forceOpen && toggle(key)} style={{ cursor: forceOpen ? 'default' : 'pointer' }}>
                    <Icon name={open ? 'chevron-down' : 'chevron-right'} style={{ fontSize: 11 }} /> {title}
                    {count !== undefined && <span className="navcount">{count}</span>}
                </div>
                {open && items}
            </div>
        )
    }

    return (
        <nav className="side">
            <div className="nav-search">
                <Icon name="search" />
                <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="search  /" aria-label="search nav" />
                {q && (
                    <button className="iconbtn" onClick={() => setQ('')} aria-label="clear">
                        <Icon name="x" />
                    </button>
                )}
            </div>
            {!ql &&
                grp(
                    'tools',
                    'tools',
                    <>
                        <NavLink to="/builder" route={route}>▸ new scenario</NavLink>
                        <NavLink to="/recipes" route={route}>▸ auth recipes</NavLink>
                        <NavLink to="/listen" route={route}>▸ listen updates</NavLink>
                    </>,
                )}
            {!ql &&
                grp(
                    'reference',
                    'reference',
                    <>
                        <NavLink to="/schema" route={route}>▤ schema</NavLink>
                        <NavLink to="/changelog" route={route}>≡ changelog</NavLink>
                    </>,
                )}
            {guideGroups.map(([folder, items]) =>
                grp(
                    'g:' + folder,
                    folder ? `guides · ${folder}` : 'guides',
                    items.map(s => (
                        <NavLink key={s.slug} to={`/scenario/${s.slug}`} route={route}>
                            {s.interactive && (
                                <Icon name="player-play" style={{ fontSize: 11, marginRight: 4, color: 'var(--accent)' }} />
                            )}
                            {folder ? leafOf(s.slug) : s.title}
                        </NavLink>
                    )),
                ),
            )}
            {[...methodGroups].map(([ns, syms]) =>
                grp(
                    'm:' + ns,
                    `methods · ${ns}`,
                    syms.map(s => (
                        <NavLink key={s.name} to={`/method/${s.name}`} route={route}>
                            {short(s.name)}
                        </NavLink>
                    )),
                    syms.length,
                ),
            )}
            {types.length > 0 &&
                grp(
                    'types',
                    'types',
                    types.map(t => (
                        <NavLink key={t.name} to={`/type/${t.name}`} route={route}>
                            {t.name}
                        </NavLink>
                    )),
                    types.length,
                )}
            {ql && methodGroups.size === 0 && types.length === 0 && guides.length === 0 && (
                <div className="muted" style={{ padding: '8px 16px', fontSize: 12 }}>no matches</div>
            )}
        </nav>
    )
}

function NavLink({ to, route, children }: { to: string; route: string; children: React.ReactNode }) {
    return (
        <a href={'#' + to} className={route === to ? 'active' : ''}>
            {children}
        </a>
    )
}

function Page({
    spec,
    scenarios,
    route,
    describedNames,
}: {
    spec: ApiSpec
    scenarios: Scenario[]
    route: string
    describedNames: Set<string>
}) {
    const path = route.split('?')[0]! // drop the hash query (used by schema deep-links)
    const [kind, ...rest] = path.replace(/^\//, '').split('/')
    const name = decodeURIComponent(rest.join('/'))
    if (kind === 'method' && spec.methods[name]) return <SymbolPage spec={spec} sym={spec.methods[name]} hasDesc={describedNames.has(name)} />
    if (kind === 'constructor' && spec.constructors[name])
        return <SymbolPage spec={spec} sym={spec.constructors[name]} hasDesc={describedNames.has(name)} />
    if (kind === 'type' && spec.types[name]) return <TypePage spec={spec} type={spec.types[name]} hasDesc={describedNames.has(name)} />
    if (kind === 'schema') return <SchemaPage spec={spec} />
    if (kind === 'changelog') return <ChangelogPage spec={spec} />
    if (kind === 'scenario') {
        const sc = scenarios.find(s => s.slug === name)
        if (sc) return <ScenarioPage spec={spec} scenario={sc} />
    }
    if (kind === 'builder' || kind === 'playground') return <Builder spec={spec} slug={name} />
    if (kind === 'recipes') return <RecipesPage />
    if (kind === 'listen') return <ListenPage />
    return <Home spec={spec} scenarios={scenarios} />
}

function Home({ spec, scenarios }: { spec: ApiSpec; scenarios: Scenario[] }) {
    const groups = groupByNamespace(Object.values(spec.methods))
    return (
        <main className="content">
            <h1>MTProto API</h1>
            <p className="muted">
                Browse every method, type and constructor — pinned to a TL layer. Generated from your `.tl` schema.
            </p>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(96px,1fr))', margin: '16px 0' }}>
                <Stat n={Object.keys(spec.methods).length} l="methods" href="#/schema?filter=methods" />
                <Stat n={Object.keys(spec.constructors).length} l="constructors" href="#/schema?filter=constructors" />
                <Stat n={Object.keys(spec.types).length} l="types" href="#/schema?filter=types" />
                <Stat n={`${spec.layers[0]}–${spec.latestLayer}`} l="layers" href="#/changelog" />
            </div>
            <h2>Methods by namespace</h2>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
                {[...groups].map(([ns, syms]) => (
                    <a className="card" key={ns} href={`#/schema?ns=${ns === 'core' ? '' : ns + '.'}`}>
                        <div style={{ fontFamily: 'var(--mono)' }}>
                            {ns} <span className="muted">· {syms.length}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 3, fontFamily: 'var(--mono)' }}>
                            {syms
                                .slice(0, 3)
                                .map(s => short(s.name))
                                .join(' · ')}
                        </div>
                    </a>
                ))}
            </div>
            {scenarios.length > 0 && (
                <>
                    <h2>Scenarios &amp; guides</h2>
                    <div className="grid">
                        {scenarios.map(s => (
                            <a className="card" href={`#/scenario/${s.slug}`} key={s.slug}>
                                {s.interactive && (
                                    <Icon name="player-play" style={{ fontSize: 12, marginRight: 6, color: 'var(--accent)' }} />
                                )}
                                {s.title}
                                {folderOf(s.slug) && <span className="muted" style={{ fontSize: 11 }}> · {folderOf(s.slug)}</span>}
                            </a>
                        ))}
                    </div>
                </>
            )}
        </main>
    )
}

function SymbolPage({ spec, sym, hasDesc }: { spec: ApiSpec; sym: SpecSymbol; hasDesc: boolean }) {
    const { layer } = useContext(LayerCtx)
    const shape = shapeAt(sym, layer)
    const presentHere = !!shape
    const desc = useDoc(hasDesc ? `./descriptions/${sym.name}.md` : undefined)
    const descHtml = useMemo(() => (desc ? (marked.parse(desc) as string) : ''), [desc])
    return (
        <main className="content">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className={'badge' + (sym.kind === 'constructor' ? ' gray' : '')}>{sym.kind}</span>
                <h1 className="mono">{sym.name}</h1>
                {sym.removed && <span className="badge danger">removed in {sym.removedIn}</span>}
                <span className="id" style={{ marginLeft: 'auto' }}>
                    since {sym.sinceLayer} · id #{(shape ?? latestShape(sym)).id}
                </span>
            </div>

            {shape && <TlLineBox text={tlLine(sym, shape)} />}
            {shape && <CopyAs sym={sym} shape={shape} />}
            {descHtml && <div className="prose" dangerouslySetInnerHTML={{ __html: descHtml }} style={{ margin: '8px 0 4px' }} />}

            {!presentHere ? (
                <div className="callout">
                    Not available at layer {layer}.{' '}
                    {layer < sym.sinceLayer ? `Introduced in layer ${sym.sinceLayer}.` : `Removed in layer ${sym.removedIn}.`}
                </div>
            ) : (
                <>
                    <h2>Parameters · layer {layer}</h2>
                    <ParamTable spec={spec} shape={shape} sym={sym} />
                    <div style={{ marginTop: 14, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                        <div>
                            <div className="id">returns</div>
                            <TypeLink spec={spec} name={sym.type} />
                        </div>
                    </div>

                    {sym.kind === 'method' && (
                        <>
                            <h2>Try it</h2>
                            <RequestRunner method={sym.name} />
                        </>
                    )}
                </>
            )}

            <h2>Layer history</h2>
            <div>
                {sym.shapes
                    .map((run, i) => ({ run, i }))
                    .sort((a, b) => b.run.from - a.run.from)
                    .map(({ run, i }) => (
                        <div className="hist-row" key={run.from}>
                            <span className="mono" style={{ color: 'var(--accent)', width: 36 }}>
                                {run.from}
                            </span>
                            <span className="id">#{run.id}</span>
                            <span className="muted" style={{ marginLeft: 'auto' }}>
                                {runSummary(sym, i)}
                            </span>
                        </div>
                    ))}
                {sym.removed && (
                    <div className="hist-row">
                        <span className="mono" style={{ color: 'var(--danger)', width: 36 }}>
                            {sym.removedIn}
                        </span>
                        <span className="muted" style={{ marginLeft: 'auto' }}>
                            removed
                        </span>
                    </div>
                )}
            </div>

            {sym.shapes.length >= 2 && <DiffLayers sym={sym} />}
        </main>
    )
}

function DiffLayers({ sym }: { sym: SpecSymbol }) {
    // Pickable layers = the change points (where a new shape starts); diffing
    // anything between two change points yields the same result anyway.
    const points = sym.shapes.map(r => r.from)
    const [a, setA] = useState(points[0]!)
    const [b, setB] = useState(points[points.length - 1]!)
    const sa = shapeAt(sym, a)
    const sb = shapeAt(sym, b)
    const d = sa && sb ? paramDiff(sa, sb) : undefined
    const pick = (v: number, set: (n: number) => void) => (
        <select value={v} onChange={e => set(Number(e.target.value))}>
            {points.map(l => (
                <option key={l} value={l}>
                    {l}
                </option>
            ))}
        </select>
    )
    return (
        <>
            <h2>Diff layers</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}>
                {pick(a, setA)} <span className="muted">→</span> {pick(b, setB)}
            </div>
            {!d || (!d.idChanged && d.added.length + d.removed.length + d.retyped.length === 0) ? (
                <div className="muted" style={{ fontSize: 13 }}>identical at {a} and {b}.</div>
            ) : (
                <div className="mono" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
                    {d.idChanged && (
                        <div>
                            <span className="muted">id</span> {d.idChanged[0]} → {d.idChanged[1]}
                        </div>
                    )}
                    {d.added.map(n => (
                        <div key={'a' + n} style={{ color: 'var(--ok)' }}>+ {n}</div>
                    ))}
                    {d.removed.map(n => (
                        <div key={'r' + n} style={{ color: 'var(--danger)' }}>− {n}</div>
                    ))}
                    {d.retyped.map(r => (
                        <div key={'t' + r.name} style={{ color: 'var(--accent)' }}>
                            ~ {r.name}: {r.from} → {r.to}
                        </div>
                    ))}
                </div>
            )}
        </>
    )
}

function ParamTable({ spec, shape, sym }: { spec: ApiSpec; shape: SpecShape; sym: SpecSymbol }) {
    return (
        <table className="params">
            <thead>
                <tr>
                    <th style={{ width: '38%' }}>name</th>
                    <th style={{ width: '44%' }}>type</th>
                    <th style={{ width: '18%' }} />
                </tr>
            </thead>
            <tbody>
                {shape.params.map(p => (
                    <tr key={p.name}>
                        <td className="mono">
                            {p.name}
                            {!p.optional && p.name !== 'flags' && <span style={{ color: 'var(--danger)', fontSize: 11 }}> req</span>}
                        </td>
                        <td className="mono">
                            <ParamType spec={spec} p={p} />
                        </td>
                        <td>
                            {p.since > sym.sinceLayer && <span className="chip new">since {p.since}</span>}
                            {p.removed && <span className="chip removed">removed {p.until < sym.lastLayer ? `after ${p.until}` : ''}</span>}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    )
}

function ParamType({ spec, p }: { spec: ApiSpec; p: SpecParam }) {
    if (!p.ref) return <>{p.type}</>
    const prefix = p.type.slice(0, p.type.indexOf(p.ref))
    const suffix = p.type.slice(prefix.length + p.ref.length)
    return (
        <>
            <span className="muted">{prefix}</span>
            <TypeLink spec={spec} name={p.ref} />
            <span className="muted">{suffix}</span>
        </>
    )
}

function TypeLink({ spec, name }: { spec: ApiSpec; name: string }) {
    if (spec.types[name]) return <a href={`#/type/${name}`}>{name}</a>
    if (spec.constructors[name]) return <a href={`#/constructor/${name}`}>{name}</a>
    return <span>{name}</span>
}

function TlLineBox({ text }: { text: string }) {
    return (
        <div className="tl-line">
            <code>{highlightTlLine(text)}</code>
            <button className="iconbtn" aria-label="copy .tl" title="copy .tl" onClick={() => void navigator.clipboard?.writeText(text)}>
                <Icon name="copy" />
            </button>
        </div>
    )
}

/** Placeholder JS value for a param's raw TL type (for the JSON / step skeletons). */
function placeholderFor(raw: string): unknown {
    const t = raw.replace(/^\w+\.\d+\?/, '') // strip a `flags.N?` prefix
    if (t === 'int' || t === 'double' || t === 'long') return 0
    if (t === 'string') return ''
    if (t === 'Bool' || t === 'true') return false
    if (t === 'bytes' || t === 'int128' || t === 'int256') return ''
    if (t.startsWith('Vector')) return []
    return null // a nested boxed type — fill on the page
}

/** "Copy as" (B11 #2): the .tl line, a scenario YAML step, or a JSON request skeleton. */
function CopyAs({ sym, shape }: { sym: SpecSymbol; shape: SpecShape }) {
    const skeleton = useMemo(() => {
        const o: Record<string, unknown> = {}
        for (const p of shape.params) {
            if (p.type === '#') continue
            o[p.name] = placeholderFor(p.type)
        }
        return o
    }, [shape])
    const copy = (t: string): void => void navigator.clipboard?.writeText(t)
    const json = JSON.stringify({ _: sym.name, ...skeleton }, null, 2)
    const yp = Object.entries(skeleton)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(', ')
    const step = `- { invoke: ${sym.name}${yp ? `, params: { ${yp} }` : ''} }`
    return (
        <div className="copy-as">
            <span className="muted">copy as</span>
            <button onClick={() => copy(tlLine(sym, shape))}>.tl</button>
            {sym.kind === 'method' && <button onClick={() => copy(step)}>scenario step</button>}
            <button onClick={() => copy(json)}>JSON</button>
        </div>
    )
}

function LinkList({ items }: { items: UsageRef[] }) {
    return (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
            {items.map(it => (
                <a
                    className="card mono"
                    href={`#/${it.kind}/${it.name}`}
                    key={it.kind + ':' + it.name}
                    style={{ fontSize: 12.5, wordBreak: 'break-word', overflowWrap: 'anywhere' }}
                >
                    {it.name}
                </a>
            ))}
        </div>
    )
}

function TypePage({ spec, type, hasDesc }: { spec: ApiSpec; type: SpecType; hasDesc: boolean }) {
    const { layer } = useContext(LayerCtx)
    const usage = useMemo(() => typeUsage(spec, type.name, layer), [spec, type.name, layer])
    const desc = useDoc(hasDesc ? `./descriptions/${type.name}.md` : undefined)
    const descHtml = useMemo(() => (desc ? (marked.parse(desc) as string) : ''), [desc])
    return (
        <main className="content">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="badge gray">type</span>
                <h1 className="mono">{type.name}</h1>
                {type.removed && <span className="badge danger">removed in {type.removedIn}</span>}
                <span className="id" style={{ marginLeft: 'auto' }}>since {type.sinceLayer}</span>
            </div>
            {descHtml && <div className="prose" dangerouslySetInnerHTML={{ __html: descHtml }} style={{ margin: '8px 0 4px' }} />}
            <h2>Constructors · {type.constructors.length}</h2>
            <div className="grid">
                {type.constructors.map(cn => {
                    const c = spec.constructors[cn]
                    return (
                        <a className="card mono" href={`#/constructor/${cn}`} key={cn} style={c?.removed ? { textDecoration: 'line-through', opacity: 0.6 } : {}}>
                            {cn} <span className="id">#{c && latestShape(c).id}</span>
                            {c?.removed && <span className="chip removed" style={{ marginLeft: 8 }}>removed in {c.removedIn}</span>}
                        </a>
                    )
                })}
            </div>
            {usage.returnedBy.length > 0 && (
                <>
                    <h2>Returned by · {usage.returnedBy.length}</h2>
                    <LinkList items={usage.returnedBy} />
                </>
            )}
            {usage.usedBy.length > 0 && (
                <>
                    <h2>Used by · {usage.usedBy.length}</h2>
                    <LinkList items={usage.usedBy} />
                </>
            )}
        </main>
    )
}

function ScenarioPage({ spec, scenario }: { spec: ApiSpec; scenario: Scenario }) {
    // The guide body is fetched on open (scenarios/<slug>.md), not bundled up front.
    const body = useDoc(`./scenarios/${scenario.slug}.md`)
    const html = useMemo(() => renderScenarioHtml(body, spec), [body, spec])
    // A guide can embed a ```scenario fenced block (mt-tl-test YAML) — if present,
    // "open" pre-fills the builder with it (auth-arg values are blanked on import).
    const scenarioYaml = useMemo(() => /```scenario\s*\n([\s\S]*?)```/.exec(body)?.[1], [body])
    return (
        <main className="content">
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>
                <a href="#/">Guides</a> › {scenario.title}
            </div>
            <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
            <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <a
                    className="card"
                    href={`#/builder/${scenario.slug}`}
                    style={{ display: 'inline-block' }}
                    onClick={() => scenarioYaml && sessionStorage.setItem('mt-tl-studio.import', scenarioYaml)}
                >
                    <Icon name="player-play" />{' '}
                    {scenarioYaml ? 'open as interactive scenario (pre-filled)' : 'open in the scenario builder'}
                </a>
            </div>
        </main>
    )
}

// Render the guide's Markdown, then turn `code` spans that name a known method /
// type / constructor into cross-links into the reference.
function renderScenarioHtml(body: string, spec: ApiSpec): string {
    const html = marked.parse(body) as string
    return html.replace(/<code>([A-Za-z][\w.]*)<\/code>/g, (m, name: string) => {
        const to = spec.methods[name]
            ? `#/method/${name}`
            : spec.constructors[name]
              ? `#/constructor/${name}`
              : spec.types[name]
                ? `#/type/${name}`
                : null
        return to ? `<a href="${to}">${m}</a>` : m
    })
}

function Stat({ n, l, href }: { n: number | string; l: string; href?: string }) {
    const inner = (
        <>
            <div className="n">{n}</div>
            <div className="l">{l}</div>
        </>
    )
    return href ? (
        <a className="stat" href={href}>
            {inner}
        </a>
    ) : (
        <div className="stat">{inner}</div>
    )
}

function short(name: string): string {
    const i = name.indexOf('.')
    return i < 0 ? name : name.slice(i + 1)
}
function groupByNamespace(syms: SpecSymbol[]): Map<string, SpecSymbol[]> {
    const m = new Map<string, SpecSymbol[]>()
    for (const s of [...syms].sort((a, b) => a.name.localeCompare(b.name))) {
        const ns = s.name.includes('.') ? s.name.slice(0, s.name.indexOf('.')) : '(root)'
        ;(m.get(ns) ?? m.set(ns, []).get(ns)!).push(s)
    }
    return m
}
/** One-line summary for the i-th change point: what changed vs the previous run. */
function runSummary(sym: SpecSymbol, i: number): string {
    if (i <= 0) return 'introduced'
    const prev = sym.shapes[i - 1]!
    const cur = sym.shapes[i]!
    // Same id across a presence gap — the symbol vanished then returned unchanged.
    if (prev.id === cur.id) return 'reintroduced'
    const curNames = new Set(cur.params.map(p => p.name))
    const before = new Set(prev.params.map(p => p.name))
    const added = [...curNames].filter(n => !before.has(n))
    const removed = [...before].filter(n => !curNames.has(n))
    const parts: string[] = []
    if (added.length) parts.push('+ ' + added.join(', '))
    if (removed.length) parts.push('− ' + removed.join(', '))
    if (!parts.length) parts.push('id changed') // consecutive runs always differ in id here
    return parts.join(' · ')
}
