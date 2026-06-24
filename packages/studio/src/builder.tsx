import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icon.js'
import { parse as parseYaml } from 'yaml'
import { useSession } from './session.js'
import { FieldsEditor } from './field-input.js'
import { yamlValue, jsonView } from './try-it.js'
import { listRecipes, runRecipeCode } from './recipes.js'
import { BrowserSession, RpcError } from './client/browser-session.js'
import { Scope, getByPath } from './client/scope.js'
import { hexToBytes, fmtMsgId } from './client/bytes.js'
import type { ApiSpec } from './spec-types.js'
import type { BObject, BValue } from './client/codec.js'

const IMPORT_KEY = 'mt-tl-studio.import'
const DRAFT_KEY = 'mt-tl-studio.scenario'
const toHexStr = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

type Kind = 'invoke' | 'expectUpdate'
type ExpectMode = 'result' | 'error'
interface User {
    id: number
    name: string
    layer: string
    recipe: string
    with: string
}
interface Step {
    id: number
    as: string
    label: string
    kind: Kind
    method: string
    value: BObject
    expectMode: ExpectMode
    expect: string // result _ / error code / update _
    matchField: string // expectUpdate: optional dot-path to assert
    matchValue: string // expectUpdate: expected value at matchField
    timeoutSec: string // expectUpdate: how long to wait
    capture: string // invoke: `scopeKey = result.path` pairs (comma-sep) → later `${scopeKey}`
}

/** Parse a `key = a.b, key2 = c` capture spec into [scopeKey, resultPath] pairs. */
function parseCapture(spec: string): Array<[string, string]> {
    return spec
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
            const i = s.indexOf('=')
            return i < 0 ? ([s.trim(), s.trim()] as [string, string]) : ([s.slice(0, i).trim(), s.slice(i + 1).trim()] as [string, string])
        })
        .filter(([k, p]) => k && p)
}
interface RunResult {
    status: 'ok' | 'err' | 'mismatch'
    text: string
    detail?: string
    msgId?: string
}
interface LogLine {
    text: string
    kind: 'info' | 'ok' | 'err'
}

let seq = 0
const nid = (): number => ++seq

const stripTag = (value: BObject): Record<string, unknown> => {
    const { _: _tag, ...rest } = value
    return rest
}
const paramsInline = (value: BObject): string => {
    const keys = Object.keys(value).filter(k => k !== '_')
    return keys.length ? `{ ${keys.map(k => `${k}: ${yamlValue(value[k] as BValue)}`).join(', ')} }` : ''
}
const compactJson = (raw: string): string => {
    try {
        return JSON.stringify(JSON.parse(raw))
    } catch {
        return raw.trim()
    }
}

// Share a scenario in a compressed URL (B11 #6): deflate the YAML → base64url.
// CompressionStream is native in modern browsers; the link stays small for typical
// scenarios (warn + fall back to file export if it's huge).
const b64url = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    const u = new Uint8Array(b.length)
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i)
    return u
}
async function deflate(str: string): Promise<string> {
    const stream = new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(new CompressionStream('deflate'))
    return b64url(new Uint8Array(await new Response(stream).arrayBuffer()))
}
async function inflate(b64: string): Promise<string> {
    const stream = new Blob([unb64url(b64)]).stream().pipeThrough(new DecompressionStream('deflate'))
    return new TextDecoder().decode(await new Response(stream).arrayBuffer())
}
const getPath = (obj: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
const blankValues = (o: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.keys(o).map(k => [k, '']))

const emptyStep = (as: string): Step => ({
    id: nid(),
    as,
    label: '',
    kind: 'invoke',
    method: '',
    value: { _: '' },
    expectMode: 'result',
    expect: '',
    matchField: '',
    matchValue: '',
    timeoutSec: '',
    capture: '',
})

/** Parse an mt-tl-test YAML scenario into builder state (auth `with` values blanked). */
function fromScenario(text: string): { url?: string; users: User[]; steps: Step[] } {
    const s = (parseYaml(text) ?? {}) as Record<string, any>
    const url = s.target?.url as string | undefined
    const usersObj = (s.users ?? {}) as Record<string, any>
    const users: User[] = Object.keys(usersObj).length
        ? Object.entries(usersObj).map(([name, u]) => ({
              id: nid(),
              name,
              layer: u?.layer != null ? String(u.layer) : '',
              recipe: u?.auth?.recipe ?? '',
              // keep the auth-arg KEYS but blank the (secret) values
              with: u?.auth?.with ? JSON.stringify(blankValues(u.auth.with)) : '',
          }))
        : [{ id: nid(), name: 'user', layer: '', recipe: '', with: '' }]
    const fallbackUser = users[0]?.name ?? 'user'
    const steps: Step[] = ((s.steps ?? []) as any[]).map(raw => {
        const st = emptyStep(raw.as ?? fallbackUser)
        st.as = raw.as ?? fallbackUser
        st.label = raw.label ?? ''
        if (raw.expectUpdate !== undefined) {
            st.kind = 'expectUpdate'
            const m = raw.expectUpdate ?? {}
            st.expect = m._ ?? ''
            const extra = Object.keys(m).filter(k => k !== '_')
            if (extra.length) {
                st.matchField = extra[0]!
                st.matchValue = String(m[extra[0]!])
            }
            if (raw.timeoutMs) st.timeoutSec = String(raw.timeoutMs / 1000)
        } else {
            st.kind = 'invoke'
            st.method = raw.invoke ?? ''
            st.value = { _: st.method, ...(raw.params ?? {}) }
            if (raw.expectError) {
                st.expectMode = 'error'
                st.expect = raw.expectError.code != null ? String(raw.expectError.code) : ''
            } else {
                st.expectMode = 'result'
                st.expect = raw.expect?._ ?? ''
            }
            if (raw.capture && typeof raw.capture === 'object') {
                st.capture = Object.entries(raw.capture as Record<string, unknown>)
                    .map(([k, p]) => `${k} = ${String(p)}`)
                    .join(', ')
            }
        }
        return st
    })
    return { url, users, steps }
}

interface Draft {
    name: string
    users: User[]
    steps: Step[]
}
// Persist the draft across navigation/refresh. Bytes fields (Uint8Array) aren't
// JSON-native, so tag them as { __u8: hex } and restore on read.
function serializeDraft(d: Draft): string {
    return JSON.stringify(d, (_k, v) => (v instanceof Uint8Array ? { __u8: toHexStr(v) } : v))
}
function deserializeDraft(json: string): Draft {
    return JSON.parse(json, (_k, v) =>
        v && typeof v === 'object' && typeof (v as { __u8?: unknown }).__u8 === 'string'
            ? hexToBytes((v as { __u8: string }).__u8)
            : v,
    ) as Draft
}

/**
 * Multi-user scenario builder: declare users (own session + layer + auth recipe),
 * assemble typed steps run `as` a user (invoke with expect/expectError, or
 * expectUpdate with a timeout + field match), RUN over real sessions with a full
 * run-log (req msg_id per call), import/export mt-tl-test YAML.
 */
export function Builder({ spec, slug }: { spec: ApiSpec; slug?: string }) {
    const { openUser, pem, sess, url } = useSession()
    // Initial state, in priority order (read in the initializer → StrictMode-safe):
    //   1) a guide's stashed ```scenario import, 2) the persisted draft (survives
    //   navigation/refresh), 3) a blank scenario. Bump `nid` past any restored ids.
    const [initial] = useState<{ name?: string; url?: string; users?: User[]; steps?: Step[] } | null>(() => {
        let parsed: { name?: string; url?: string; users?: User[]; steps?: Step[] } | null = null
        try {
            const y = sessionStorage.getItem(IMPORT_KEY)
            if (y) parsed = fromScenario(y)
        } catch {
            /* ignore */
        }
        if (!parsed) {
            try {
                const d = localStorage.getItem(DRAFT_KEY)
                if (d) parsed = deserializeDraft(d)
            } catch {
                /* ignore */
            }
        }
        if (parsed) for (const it of [...(parsed.users ?? []), ...(parsed.steps ?? [])]) if (it && it.id > seq) seq = it.id
        return parsed
    })
    const [ready, setReady] = useState(false)
    const [name, setName] = useState(initial?.name ?? (slug && slug !== '' ? slug : 'scenario'))
    const [users, setUsers] = useState<User[]>(
        initial?.users?.length ? initial.users : [{ id: nid(), name: 'user', layer: '', recipe: '', with: '' }],
    )
    const [steps, setSteps] = useState<Step[]>(initial?.steps?.length ? initial.steps : [emptyStep('user')])
    const [results, setResults] = useState<Record<number, RunResult>>({})
    const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
    const [running, setRunning] = useState(false)
    const [log, setLog] = useState<LogLine[]>([])
    const [importErr, setImportErr] = useState<string>()
    const [shared, setShared] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        sess.loadWire().then(() => setReady(true)).catch(() => {})
    }, [sess])

    useEffect(() => {
        // NOTE: deliberately do NOT adopt the scenario's target.url — that would
        // overwrite the connbar's live server URL (persisted to localStorage) and
        // break the running connection. The builder runs on the shared session
        // (connbar url); the scenario's target is informational only.
        // Clear the guide-import after both StrictMode mounts initialized from it.
        const t = setTimeout(() => {
            try {
                sessionStorage.removeItem(IMPORT_KEY)
            } catch {
                /* ignore */
            }
        }, 0)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Persist the draft so a misclick to another screen / a refresh doesn't lose it.
    useEffect(() => {
        try {
            localStorage.setItem(DRAFT_KEY, serializeDraft({ name, users, steps }))
        } catch {
            /* ignore */
        }
    }, [name, users, steps])

    const methodNames = useMemo(() => Object.keys(spec.methods).sort(), [spec])
    const yaml = useMemo(() => toYaml(url, users, steps), [url, users, steps])

    const patch = (id: number, p: Partial<Step>): void => setSteps(s => s.map(x => (x.id === id ? { ...x, ...p } : x)))
    const move = (id: number, d: number): void =>
        setSteps(s => {
            const i = s.findIndex(x => x.id === id)
            const j = i + d
            if (j < 0 || j >= s.length) return s
            const c = [...s]
            ;[c[i], c[j]] = [c[j]!, c[i]!]
            return c
        })
    const toggleCollapse = (id: number): void =>
        setCollapsed(c => {
            const n = new Set(c)
            n.has(id) ? n.delete(id) : n.add(id)
            return n
        })

    const applyImport = (text: string): void => {
        try {
            const r = fromScenario(text)
            // don't adopt r.url — keep the connbar's live server (see the mount effect)
            if (r.users.length) setUsers(r.users)
            setSteps(r.steps.length ? r.steps : [emptyStep('user')])
            setResults({})
            setImportErr(undefined)
        } catch (e) {
            setImportErr(e instanceof Error ? e.message : String(e))
        }
    }
    const onPickFile = async (file: File | undefined): Promise<void> => {
        if (file) applyImport(await file.text())
    }
    const clearScenario = (): void => {
        if (!window.confirm('Clear the current scenario? This drops all steps and users.')) return
        setName(slug && slug !== '' ? slug : 'scenario')
        setUsers([{ id: nid(), name: 'user', layer: '', recipe: '', with: '' }])
        setSteps([emptyStep('user')])
        setResults({})
        setLog([])
        try {
            localStorage.removeItem(DRAFT_KEY)
        } catch {
            /* ignore */
        }
    }

    // A shared link (#/builder?s=<deflated yaml>) → decompress + import (async, B11 #6).
    useEffect(() => {
        const s = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('s')
        if (s) inflate(s).then(applyImport).catch(e => setImportErr('share link: ' + (e instanceof Error ? e.message : String(e))))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const exportYaml = (): void => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([yaml], { type: 'text/yaml' }))
        a.download = `${name.replace(/\W+/g, '_')}.scenario.yaml`
        a.click()
        URL.revokeObjectURL(a.href)
    }
    const downloadLog = (): void => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([log.map(l => l.text).join('\n')], { type: 'text/plain' }))
        a.download = `${name.replace(/\W+/g, '_')}.run.log`
        a.click()
        URL.revokeObjectURL(a.href)
    }
    const share = async (): Promise<void> => {
        setImportErr(undefined)
        try {
            const hash = `#/builder?s=${await deflate(yaml)}`
            const full = location.origin + location.pathname + hash
            if (full.length > 8000) {
                setImportErr('scenario too large for a share link — use .yaml export and send the file')
                return
            }
            history.replaceState(null, '', hash)
            await navigator.clipboard?.writeText(full)
            setShared(true)
            setTimeout(() => setShared(false), 1500)
        } catch (e) {
            setImportErr('share: ' + (e instanceof Error ? e.message : String(e)))
        }
    }

    const run = async (): Promise<void> => {
        setRunning(true)
        setResults({})
        setLog([])
        const line = (text: string, kind: LogLine['kind'] = 'info'): void => setLog(l => [...l, { text, kind }])
        const sessions = new Map<string, BrowserSession>()
        const scope = new Scope() // shared across steps for ${...} (generators + captures)
        try {
            for (const u of users) {
                try {
                    // negotiate a layer always (real servers need initConnection first);
                    // "default" → the schema's latest layer.
                    const s = await openUser({ layer: u.layer ? Number(u.layer) : spec.latestLayer })
                    if (u.recipe) {
                        const recipe = listRecipes().find(r => r.name === u.recipe)
                        if (!recipe) throw new Error(`recipe "${u.recipe}" not found`)
                        const extra = u.with?.trim() ? (JSON.parse(u.with) as Record<string, unknown>) : {}
                        const rScope = await runRecipeCode(recipe, s, msg => line(`  [${u.name}] ${msg}`), extra)
                        // recipe captures (ctx.set) become referenceable in steps via ${key}
                        for (const [k, v] of Object.entries(rScope)) scope.set(k, v)
                    }
                    sessions.set(u.name, s)
                    line(`connected ${u.name}${u.layer ? ` @layer ${u.layer}` : ''}${u.recipe ? ` · auth ${u.recipe}` : ''}`, 'ok')
                } catch (e) {
                    line(`✕ ${u.name} auth/connect: ${e instanceof Error ? e.message : String(e)}`, 'err')
                    const firstStep = steps.find(s => s.as === u.name)
                    if (firstStep) setResults(p => ({ ...p, [firstStep.id]: { status: 'err', text: 'user not connected' } }))
                }
            }
            for (let i = 0; i < steps.length; i++) {
                const st = steps[i]!
                const s = sessions.get(st.as)
                if (!s) {
                    setResults(p => ({ ...p, [st.id]: { status: 'err', text: `user "${st.as}" has no session` } }))
                    line(`✕ #${i + 1} [${st.as}] ${labelOf(st)}: no session`, 'err')
                    continue
                }
                await runStep(i, st, s, scope, setResults, line)
            }
            line('done', 'ok')
        } finally {
            for (const s of sessions.values()) s.close()
            setRunning(false)
        }
    }

    const userNames = users.map(u => u.name)

    return (
        <main className="content" style={{ maxWidth: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <span className="badge">scenario builder</span>
                <input value={name} onChange={e => setName(e.target.value)} style={{ width: 160 }} aria-label="scenario name" />
                <span className="id">target {url}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <button onClick={run} disabled={running || !pem} title={pem ? '' : 'set the server URL + key in the bar above'}
                        style={pem ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
                        <Icon name={running ? 'loader-2' : 'player-play'} /> run
                    </button>
                    <button onClick={() => fileRef.current?.click()} title="import an mt-tl-test scenario YAML">
                        <Icon name="upload" /> import
                    </button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".yaml,.yml,.txt"
                        style={{ display: 'none' }}
                        onChange={e => {
                            void onPickFile(e.target.files?.[0])
                            e.target.value = ''
                        }}
                    />
                    <button onClick={exportYaml}>
                        <Icon name="download" /> .yaml
                    </button>
                    <button onClick={() => void share()} title="copy a shareable link to this scenario">
                        <Icon name={shared ? 'check' : 'link'} /> {shared ? 'copied' : 'share'}
                    </button>
                    <button onClick={clearScenario} title="drop the current scenario" style={{ color: 'var(--danger)' }}>
                        <Icon name="trash" /> clear
                    </button>
                </span>
            </div>
            {!pem && (
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                    set the server URL + public key in the connection bar above to run · import/export work offline
                </div>
            )}
            {importErr && <div className="callout danger">import failed — {importErr}</div>}

            <Users users={users} setUsers={setUsers} spec={spec} />

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 18, alignItems: 'start' }}>
                <div>
                    <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', margin: '6px 0' }}>
                        steps
                    </div>
                    {steps.map((st, i) => (
                        <StepCard
                            key={st.id}
                            st={st}
                            index={i}
                            userNames={userNames}
                            methodNames={methodNames}
                            ready={ready}
                            res={results[st.id]}
                            collapsed={collapsed.has(st.id)}
                            onToggle={() => toggleCollapse(st.id)}
                            patch={patch}
                            move={move}
                            remove={() => setSteps(s => s.filter(x => x.id !== st.id))}
                        />
                    ))}
                    <button onClick={() => setSteps(s => [...s, emptyStep(userNames[0] ?? 'user')])}>
                        <Icon name="plus" /> add step
                    </button>
                </div>

                <div>
                    <h2 style={{ marginTop: 0 }}>
                        {name}.scenario.yaml <span className="muted" style={{ fontSize: 12 }}>· live</span>
                    </h2>
                    <pre className="preview">{yaml}</pre>

                    {log.length > 0 && (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 6px' }}>
                                <h2 style={{ margin: 0 }}>Run log</h2>
                                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                                    <button onClick={() => void navigator.clipboard?.writeText(log.map(l => l.text).join('\n'))}>
                                        <Icon name="copy" /> copy
                                    </button>
                                    <button onClick={downloadLog}>
                                        <Icon name="download" /> .log
                                    </button>
                                </span>
                            </div>
                            <pre className="preview">
                                {log.map((l, i) => (
                                    <div
                                        key={i}
                                        style={{ color: l.kind === 'err' ? 'var(--danger)' : l.kind === 'ok' ? 'var(--ok)' : undefined }}
                                    >
                                        {l.text}
                                    </div>
                                ))}
                            </pre>
                        </>
                    )}
                </div>
            </div>
        </main>
    )
}

function Users({ users, setUsers, spec }: { users: User[]; setUsers: (f: (u: User[]) => User[]) => void; spec: ApiSpec }) {
    const layers = [...spec.layers].reverse()
    const recipes = listRecipes()
    return (
        <div style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', margin: '6px 0' }}>
                users
            </div>
            {users.map((u, i) => (
                <div key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                    <input
                        value={u.name}
                        placeholder="name"
                        onChange={e => setUsers(us => us.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                        style={{ width: 130 }}
                    />
                    <label className="muted" style={{ fontSize: 12 }}>
                        layer
                        <select
                            value={u.layer}
                            onChange={e => setUsers(us => us.map((x, j) => (j === i ? { ...x, layer: e.target.value } : x)))}
                            style={{ marginLeft: 6 }}
                        >
                            <option value="">default</option>
                            {layers.map(l => (
                                <option key={l} value={l}>
                                    {l}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="muted" style={{ fontSize: 12 }}>
                        auth
                        <select
                            value={u.recipe}
                            onChange={e => setUsers(us => us.map((x, j) => (j === i ? { ...x, recipe: e.target.value } : x)))}
                            style={{ marginLeft: 6 }}
                        >
                            <option value="">anonymous</option>
                            {/* an imported recipe may not be saved locally — keep it selectable */}
                            {u.recipe && !recipes.some(r => r.name === u.recipe) && (
                                <option value={u.recipe}>{u.recipe} (not saved)</option>
                            )}
                            {recipes.map(r => (
                                <option key={r.name} value={r.name}>
                                    {r.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    {u.recipe && (
                        <input
                            value={u.with}
                            placeholder='with (JSON): { "phone": "…" }'
                            className="mono"
                            onChange={e => setUsers(us => us.map((x, j) => (j === i ? { ...x, with: e.target.value } : x)))}
                            style={{ flex: 1, minWidth: 160, fontSize: 12 }}
                        />
                    )}
                    {users.length > 1 && (
                        <button onClick={() => setUsers(us => us.filter((_, j) => j !== i))} aria-label="remove user">
                            ×
                        </button>
                    )}
                </div>
            ))}
            <button onClick={() => setUsers(us => [...us, { id: nid(), name: `user${us.length + 1}`, layer: '', recipe: '', with: '' }])}>
                <Icon name="plus" /> add user
            </button>
        </div>
    )
}

function StepCard({
    st,
    index,
    userNames,
    methodNames,
    ready,
    res,
    collapsed,
    onToggle,
    patch,
    move,
    remove,
}: {
    st: Step
    index: number
    userNames: string[]
    methodNames: string[]
    ready: boolean
    res?: RunResult
    collapsed: boolean
    onToggle: () => void
    patch: (id: number, p: Partial<Step>) => void
    move: (id: number, d: number) => void
    remove: () => void
}) {
    return (
        <div className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: collapsed ? 0 : 8, flexWrap: 'wrap' }}>
                <button onClick={onToggle} aria-label="collapse" className="iconbtn" style={{ width: 26, height: 26 }}>
                    <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} />
                </button>
                <span className="id">#{index + 1}</span>
                <span className="muted" style={{ fontSize: 12 }}>as</span>
                <select value={st.as} onChange={e => patch(st.id, { as: e.target.value })}>
                    {userNames.map(n => (
                        <option key={n} value={n}>
                            {n}
                        </option>
                    ))}
                </select>
                <select value={st.kind} onChange={e => patch(st.id, { kind: e.target.value as Kind })}>
                    <option value="invoke">invoke</option>
                    <option value="expectUpdate">expectUpdate</option>
                </select>
                {collapsed && (
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text2)' }}>
                        {st.kind === 'invoke' ? st.method || '—' : st.expect || 'update'}
                        {st.label ? ` · ${st.label}` : ''}
                    </span>
                )}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button onClick={() => move(st.id, -1)} aria-label="up">↑</button>
                    <button onClick={() => move(st.id, 1)} aria-label="down">↓</button>
                    <button onClick={remove} aria-label="remove">×</button>
                </span>
            </div>

            {!collapsed && (
                <>
                    <input
                        value={st.label}
                        placeholder="label (optional)"
                        onChange={e => patch(st.id, { label: e.target.value })}
                        style={{ width: '100%', marginBottom: 8, fontSize: 12 }}
                    />
                    {st.kind === 'invoke' ? (
                        <>
                            <select
                                value={st.method}
                                onChange={e => patch(st.id, { method: e.target.value, value: { _: e.target.value } })}
                                style={{ width: '100%', marginBottom: 8 }}
                            >
                                <option value="">— method —</option>
                                {methodNames.map(m => (
                                    <option key={m} value={m}>
                                        {m}
                                    </option>
                                ))}
                            </select>
                            {ready && st.method && (
                                <FieldsEditor defName={st.method} value={st.value} onChange={v => patch(st.id, { value: v })} />
                            )}
                            <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                                <select value={st.expectMode} onChange={e => patch(st.id, { expectMode: e.target.value as ExpectMode })}>
                                    <option value="result">expect result</option>
                                    <option value="error">expect error</option>
                                </select>
                                <input
                                    value={st.expect}
                                    placeholder={st.expectMode === 'error' ? 'error code (e.g. 401) — optional' : 'result _ (e.g. boolTrue) — optional'}
                                    onChange={e => patch(st.id, { expect: e.target.value })}
                                    style={{ flex: 1 }}
                                />
                            </div>
                            <input
                                value={st.capture}
                                placeholder="capture: scopeKey = result.path, … — use later as ${scopeKey}"
                                className="mono"
                                onChange={e => patch(st.id, { capture: e.target.value })}
                                style={{ width: '100%', marginTop: 6, fontSize: 12 }}
                            />
                        </>
                    ) : (
                        <>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <input
                                    value={st.expect}
                                    placeholder="update _ (e.g. updateNote)"
                                    onChange={e => patch(st.id, { expect: e.target.value })}
                                    style={{ flex: 2 }}
                                />
                                <input
                                    type="number"
                                    value={st.timeoutSec}
                                    placeholder="timeout s"
                                    onChange={e => patch(st.id, { timeoutSec: e.target.value })}
                                    style={{ width: 90 }}
                                />
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                                <input
                                    value={st.matchField}
                                    placeholder="match field (e.g. update.wallet_id) — optional"
                                    className="mono"
                                    onChange={e => patch(st.id, { matchField: e.target.value })}
                                    style={{ flex: 2, fontSize: 12 }}
                                />
                                <input
                                    value={st.matchValue}
                                    placeholder="equals"
                                    onChange={e => patch(st.id, { matchValue: e.target.value })}
                                    style={{ flex: 1 }}
                                />
                            </div>
                        </>
                    )}
                    {res && (
                        <div className={'result ' + (res.status === 'ok' ? 'ok' : 'err')} style={{ marginTop: 8 }}>
                            <div className="result-head">
                                <span className="mono" style={{ color: res.status === 'ok' ? 'var(--ok)' : 'var(--danger)' }}>
                                    {res.status === 'ok' ? '✓' : '✕'} {res.text}
                                </span>
                                {res.msgId && (
                                    <span className="id" style={{ marginLeft: 'auto' }}>
                                        msg_id {res.msgId}
                                    </span>
                                )}
                            </div>
                            {res.detail && (
                                <pre className="preview" style={{ margin: 0 }}>
                                    {res.detail}
                                </pre>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

async function runStep(
    index: number,
    st: Step,
    s: BrowserSession,
    scope: Scope,
    setResults: (f: (p: Record<number, RunResult>) => Record<number, RunResult>) => void,
    line: (text: string, kind?: LogLine['kind']) => void,
): Promise<void> {
    const set = (r: RunResult): void => setResults(p => ({ ...p, [st.id]: r }))
    const tag = `#${index + 1} [${st.as}] ${labelOf(st)}`
    // capture result fields into the scope for later `${...}` references
    const capture = (result: BObject): void => {
        for (const [key, path] of parseCapture(st.capture)) {
            scope.set(key, getByPath(result, path))
            line(`  captured ${key} = ${JSON.stringify(scope.get(key))}`)
        }
    }

    if (st.kind === 'expectUpdate') {
        const pred = (u: BObject): boolean => {
            if (st.expect && u._ !== st.expect) return false
            if (st.matchField && String(getPath(u, st.matchField)) !== st.matchValue) return false
            return true
        }
        const timeoutMs = st.timeoutSec ? Number(st.timeoutSec) * 1000 : undefined
        try {
            const u = await s.expectUpdate(pred, timeoutMs)
            set({ status: 'ok', text: `got ${u._}`, detail: jsonView(u) })
            line(`✓ ${tag}: update ${u._}`, 'ok')
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            set({ status: 'err', text: msg })
            line(`✕ ${tag}: ${msg}`, 'err')
        }
        return
    }

    if (!st.method) return
    // resolve ${rand.long} / ${capturedKey} / … just before sending
    const params = scope.interpolate(stripTag(st.value)) as Record<string, unknown>
    let msgId = ''
    const onSent = (id: bigint): void => {
        msgId = fmtMsgId(id)
    }
    if (st.expectMode === 'error') {
        try {
            const r = await s.invoke(st.method, params, { onSent })
            set({ status: 'err', text: `expected an error, got ${(r as BObject)._}`, detail: jsonView(r as BValue), msgId })
            line(`✕ ${tag} → msg_id ${msgId}: expected error, got ${(r as BObject)._}`, 'err')
        } catch (e) {
            if (e instanceof RpcError) {
                const match = !st.expect || String(e.code) === st.expect
                set({
                    status: match ? 'ok' : 'mismatch',
                    text: match ? `rpc_error ${e.code} ${e.message}` : `expected ${st.expect}, got ${e.code}`,
                    msgId,
                })
                line(`${match ? '✓' : '✕'} ${tag} → msg_id ${msgId}: rpc_error ${e.code} ${e.message}`, match ? 'ok' : 'err')
            } else {
                const msg = e instanceof Error ? e.message : String(e)
                set({ status: 'err', text: msg, msgId })
                line(`✕ ${tag} → msg_id ${msgId}: ${msg}`, 'err')
            }
        }
        return
    }
    try {
        const r = await s.invoke(st.method, params, { onSent })
        const got = (r as BObject)?._ ?? '∅'
        const mismatch = st.expect && got !== st.expect
        set({
            status: mismatch ? 'mismatch' : 'ok',
            text: mismatch ? `expected ${st.expect}, got ${got}` : got,
            detail: jsonView(r as BValue),
            msgId,
        })
        line(`${mismatch ? '✕' : '✓'} ${tag} → msg_id ${msgId}: ${got}`, mismatch ? 'err' : 'ok')
        if (!mismatch) capture(r as BObject)
    } catch (e) {
        if (e instanceof RpcError) {
            set({ status: 'err', text: `rpc_error ${e.code} ${e.message}`, msgId })
            line(`✕ ${tag} → msg_id ${msgId}: rpc_error ${e.code} ${e.message}`, 'err')
        } else {
            const msg = e instanceof Error ? e.message : String(e)
            set({ status: 'err', text: msg, msgId })
            line(`✕ ${tag} → msg_id ${msgId}: ${msg}`, 'err')
        }
    }
}

function labelOf(st: Step): string {
    return st.label || (st.kind === 'invoke' ? st.method || 'invoke' : `expectUpdate ${st.expect || ''}`.trim())
}

function toYaml(url: string, users: User[], steps: Step[]): string {
    const out: string[] = ['target:', `    url: ${url}`]
    const multi = users.length > 1 || users.some(u => u.layer || u.recipe)
    if (multi) {
        out.push('users:')
        for (const u of users) {
            const withInline = u.recipe && u.with?.trim() ? `, with: ${compactJson(u.with)}` : ''
            const auth = u.recipe ? `auth: { recipe: ${u.recipe}${withInline} }` : ''
            const fields = [u.layer ? `layer: ${u.layer}` : '', auth].filter(Boolean).join(', ')
            out.push(`    ${u.name}: {${fields ? ` ${fields} ` : ''}}`)
        }
    }
    out.push('steps:')
    for (const st of steps) {
        const parts: string[] = []
        if (multi) parts.push(`as: ${st.as}`)
        if (st.label) parts.push(`label: ${JSON.stringify(st.label)}`)
        if (st.kind === 'invoke') {
            parts.push(`invoke: ${st.method || 'TODO'}`)
            const p = paramsInline(st.value)
            if (p) parts.push(`params: ${p}`)
            if (st.expect) parts.push(st.expectMode === 'error' ? `expectError: { code: ${st.expect} }` : `expect: { _: ${st.expect} }`)
            const caps = parseCapture(st.capture)
            if (caps.length) parts.push(`capture: { ${caps.map(([k, p]) => `${k}: ${p}`).join(', ')} }`)
        } else {
            const m = [`_: ${st.expect || 'TODO'}`]
            if (st.matchField) m.push(`${st.matchField}: ${st.matchValue}`)
            parts.push(`expectUpdate: { ${m.join(', ')} }`)
            if (st.timeoutSec) parts.push(`timeoutMs: ${Number(st.timeoutSec) * 1000}`)
        }
        out.push(`    - { ${parts.join(', ')} }`)
    }
    return out.join('\n') + '\n'
}
