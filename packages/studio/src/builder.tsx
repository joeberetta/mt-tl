import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icon.js'
import { useSession } from './session.js'
import { FieldsEditor } from './field-input.js'
import { jsonView } from './value-format.js'
import {
    toYaml,
    fromScenario,
    emptyStep,
    emptyUser,
    parsePairs,
    type User,
    type Step,
    type Kind,
    type ExpectMode,
} from './scenario-yaml.js'
import { listRecipes, runRecipeCode } from './recipes.js'
import { BrowserSession, RpcError } from './client/browser-session.js'
import { Scope, getByPath } from './client/scope.js'
import { hexToBytes, fmtMsgId } from './client/bytes.js'
import type { ApiSpec } from './spec-types.js'
import type { BObject, BValue } from './client/codec.js'

const IMPORT_KEY = 'mt-tl-studio.import'
const DRAFT_KEY = 'mt-tl-studio.scenario'
const toHexStr = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

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

interface Draft {
    name: string
    vars: string
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

type Parsed = { name?: string; vars?: string; users?: User[]; steps?: Step[] }
// Bump `nid` past any restored ids (incl. nested auth steps) so new items don't collide.
function bumpSeq(p: Parsed): void {
    const all: Array<{ id: number }> = [...(p.users ?? []), ...(p.steps ?? [])]
    for (const u of p.users ?? []) all.push(...(u.authSteps ?? []))
    for (const it of all) if (it && it.id > seq) seq = it.id
}

/**
 * Multi-user scenario builder: declare users (own session + layer + auth: a recipe
 * or inline login steps), assemble typed steps run `as` a user (invoke with
 * expect/expectError + multi-field match, expectUpdate, or a recipe macro), RUN
 * over real sessions with a full run-log (req msg_id per call), import/export
 * mt-tl-test YAML (target schema/publicKey placeholders + vars).
 */
export function Builder({ spec, slug }: { spec: ApiSpec; slug?: string }) {
    const { openUser, pem, sess, url } = useSession()
    // Initial state, in priority order (read in the initializer → StrictMode-safe):
    //   1) a guide's stashed ```scenario import, 2) the persisted draft (survives
    //   navigation/refresh), 3) a blank scenario. Bump `nid` past any restored ids.
    const [initial] = useState<Parsed | null>(() => {
        let parsed: Parsed | null = null
        try {
            const y = sessionStorage.getItem(IMPORT_KEY)
            if (y) parsed = fromScenario(y, nid)
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
        if (parsed) bumpSeq(parsed)
        return parsed
    })
    const [ready, setReady] = useState(false)
    const [name, setName] = useState(initial?.name ?? (slug && slug !== '' ? slug : 'scenario'))
    const [vars, setVars] = useState(initial?.vars ?? '')
    const [users, setUsers] = useState<User[]>(initial?.users?.length ? initial.users : [emptyUser('user', nid)])
    const [steps, setSteps] = useState<Step[]>(initial?.steps?.length ? initial.steps : [emptyStep('user', nid)])
    const [results, setResults] = useState<Record<number, RunResult>>({})
    const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
    const [running, setRunning] = useState(false)
    const [log, setLog] = useState<LogLine[]>([])
    const [importErr, setImportErr] = useState<string>()
    const [shared, setShared] = useState(false)
    // Share link is precomputed off the gesture (see effect) so `share()` can write the
    // clipboard SYNCHRONOUSLY in the click handler — Safari rejects clipboard writes that
    // happen after an `await`. On any clipboard failure we surface the link for manual copy.
    const [shareUrl, setShareUrl] = useState('')
    const [shareWarn, setShareWarn] = useState<string>()
    const [shareLink, setShareLink] = useState<string>()
    // Hand-editable YAML pane: while focused, the textarea shows a free-typing draft and
    // every valid parse syncs back into the users/steps on the left; on blur it snaps to
    // the regenerated YAML. (#3 — e.g. paste a "scenario step" copied from a method page.)
    const [editingYaml, setEditingYaml] = useState(false)
    const [yamlDraft, setYamlDraft] = useState<string | null>(null)
    const [yamlErr, setYamlErr] = useState<string>()
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
            localStorage.setItem(DRAFT_KEY, serializeDraft({ name, vars, users, steps }))
        } catch {
            /* ignore */
        }
    }, [name, vars, users, steps])

    const methodNames = useMemo(() => Object.keys(spec.methods).sort(), [spec])
    // Live preview / editable pane shows real `with` values; the export/share artifact masks them.
    const yaml = useMemo(() => toYaml({ url, vars, users, steps }), [url, vars, users, steps])
    const maskedYaml = useMemo(() => toYaml({ url, vars, users, steps }, true), [url, vars, users, steps])
    // Precompute the deflated share link so the clipboard write in share() is synchronous
    // inside the click gesture (Safari blocks navigator.clipboard.writeText after an await).
    useEffect(() => {
        let alive = true
        deflate(maskedYaml)
            .then(s => alive && setShareUrl(`${location.origin}${location.pathname}#/builder?s=${s}`))
            .catch(() => alive && setShareUrl(''))
        return () => {
            alive = false
        }
    }, [maskedYaml])

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

    const applyParsed = (r: Parsed): void => {
        if (r.vars !== undefined) setVars(r.vars)
        if (r.users?.length) setUsers(r.users)
        setSteps(r.steps?.length ? r.steps : [emptyStep('user', nid)])
        setResults({})
    }
    const applyImport = (text: string): void => {
        try {
            // don't adopt r.url — keep the connbar's live server (see the mount effect)
            applyParsed(fromScenario(text, nid))
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
        setVars('')
        setUsers([emptyUser('user', nid)])
        setSteps([emptyStep('user', nid)])
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
        a.href = URL.createObjectURL(new Blob([maskedYaml], { type: 'text/yaml' }))
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
    const share = (): void => {
        setImportErr(undefined)
        setShareWarn(undefined)
        setShareLink(undefined)
        const proceed = (full: string, tryClipboard: boolean): void => {
            if (full.length > 8000) {
                setShareWarn('scenario too large for a share link — use .yaml export and send the file')
                return
            }
            history.replaceState(null, '', full.slice(full.indexOf('#')))
            // Show the link for manual copy if the platform blocks the clipboard (Safari /
            // restricted context) — the address bar is updated regardless, so it's never an error.
            const fallback = (): void => setShareLink(full)
            if (!tryClipboard) return fallback()
            try {
                const p = navigator.clipboard?.writeText(full)
                if (p) p.then(() => { setShared(true); setTimeout(() => setShared(false), 1500) }, fallback)
                else fallback()
            } catch {
                fallback()
            }
        }
        if (shareUrl) proceed(shareUrl, true)
        // Cold start (not precomputed yet): compute then show the link — no clipboard attempt
        // after the await (Safari would block it anyway).
        else void deflate(maskedYaml).then(s => proceed(`${location.origin}${location.pathname}#/builder?s=${s}`, false))
    }

    const run = async (): Promise<void> => {
        setRunning(true)
        setResults({})
        setLog([])
        const line = (text: string, kind: LogLine['kind'] = 'info'): void => setLog(l => [...l, { text, kind }])
        const sessions = new Map<string, BrowserSession>()
        // Seed the shared scope with the scenario's vars (then captures + recipe ctx.set merge in).
        let seed: Record<string, unknown> = {}
        try {
            seed = vars.trim() ? (JSON.parse(vars) as Record<string, unknown>) : {}
        } catch {
            line(`⚠ vars is not valid JSON — ignoring`, 'err')
        }
        const scope = new Scope(seed)
        try {
            for (const u of users) {
                try {
                    // negotiate a layer always (real servers need initConnection first);
                    // "default" → the schema's latest layer.
                    const s = await openUser({ layer: u.layer ? Number(u.layer) : spec.latestLayer })
                    if (u.authMode === 'recipe' && u.recipe) {
                        const recipe = listRecipes().find(r => r.name === u.recipe)
                        if (!recipe) throw new Error(`recipe "${u.recipe}" not found`)
                        const extra = u.with?.trim() ? (scope.interpolate(JSON.parse(u.with)) as Record<string, unknown>) : {}
                        const rScope = await runRecipeCode(recipe, s, msg => line(`  [${u.name}] ${msg}`), extra)
                        // recipe captures (ctx.set) become referenceable in steps via ${key}
                        for (const [k, v] of Object.entries(rScope)) scope.set(k, v)
                    }
                    sessions.set(u.name, s)
                    line(`connected ${u.name}${u.layer ? ` @layer ${u.layer}` : ''}${u.authMode === 'recipe' && u.recipe ? ` · auth ${u.recipe}` : ''}`, 'ok')
                    // Inline login steps: run them on this user's session before the main steps.
                    if (u.authMode === 'steps') {
                        for (const as of u.authSteps) {
                            await runStep({ ...as, as: u.name }, s, scope, setResults, line, `auth[${u.name}] ${labelOf(as)}`)
                        }
                    }
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
                await runStep(st, s, scope, setResults, line, `#${i + 1} [${st.as}] ${labelOf(st)}`)
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
                    <button onClick={share} title="copy a shareable link to this scenario">
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
            {shareWarn && <div className="callout">{shareWarn}</div>}
            {shareLink && (
                <div className="callout">
                    <div style={{ marginBottom: 6 }}>link ready — copy it (the address bar is updated too):</div>
                    <input
                        className="mono"
                        readOnly
                        value={shareLink}
                        onFocus={e => e.currentTarget.select()}
                        style={{ width: '100%', fontSize: 12, boxSizing: 'border-box' }}
                        aria-label="share link"
                    />
                </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em' }}>vars</span>
                <input
                    value={vars}
                    placeholder='top-level vars (JSON): { "tag": "hi" } — reference as ${tag}'
                    className="mono"
                    onChange={e => setVars(e.target.value)}
                    style={{ flex: 1, minWidth: 200, fontSize: 12 }}
                    aria-label="scenario vars"
                />
            </div>

            <Users users={users} setUsers={setUsers} spec={spec} methodNames={methodNames} ready={ready} results={results} />

            <div className="builder-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 18, alignItems: 'start' }}>
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
                    <button onClick={() => setSteps(s => [...s, emptyStep(userNames[0] ?? 'user', nid)])}>
                        <Icon name="plus" /> add step
                    </button>
                </div>

                <div>
                    <h2 style={{ marginTop: 0 }}>
                        {name}.scenario.yaml <span className="muted" style={{ fontSize: 12 }}>· live · editable</span>
                    </h2>
                    <textarea
                        className="preview yaml-edit"
                        spellCheck={false}
                        aria-label="scenario yaml (editable)"
                        value={editingYaml ? (yamlDraft ?? yaml) : yaml}
                        rows={Math.max(8, (editingYaml ? (yamlDraft ?? yaml) : yaml).split('\n').length + 1)}
                        onFocus={() => {
                            setEditingYaml(true)
                            setYamlDraft(yaml)
                        }}
                        onChange={e => {
                            const text = e.target.value
                            setYamlDraft(text)
                            try {
                                applyParsed(fromScenario(text, nid))
                                setYamlErr(undefined)
                            } catch (err) {
                                setYamlErr(err instanceof Error ? err.message : String(err))
                            }
                        }}
                        onBlur={() => {
                            setEditingYaml(false)
                            setYamlDraft(null)
                            setYamlErr(undefined)
                        }}
                    />
                    {editingYaml && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 4, color: yamlErr ? 'var(--danger)' : 'var(--text3)' }}>
                            {yamlErr ? `⚠ ${yamlErr}` : 'editing — valid changes sync to the steps on the left'}
                        </div>
                    )}

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

function Users({
    users,
    setUsers,
    spec,
    methodNames,
    ready,
    results,
}: {
    users: User[]
    setUsers: (f: (u: User[]) => User[]) => void
    spec: ApiSpec
    methodNames: string[]
    ready: boolean
    results: Record<number, RunResult>
}) {
    const layers = [...spec.layers].reverse()
    const recipes = listRecipes()
    const userNames = users.map(u => u.name)
    const patchUser = (i: number, p: Partial<User>): void => setUsers(us => us.map((x, j) => (j === i ? { ...x, ...p } : x)))
    const setAuthSteps = (i: number, f: (s: Step[]) => Step[]): void =>
        setUsers(us => us.map((x, j) => (j === i ? { ...x, authSteps: f(x.authSteps) } : x)))
    // The auth <select> encodes mode+recipe in one value: '' | __steps__ | recipe:<name>.
    const authValue = (u: User): string => (u.authMode === 'anonymous' ? '' : u.authMode === 'steps' ? '__steps__' : `recipe:${u.recipe}`)
    const onAuth = (i: number, v: string): void => {
        if (v === '') patchUser(i, { authMode: 'anonymous', recipe: '' })
        else if (v === '__steps__') patchUser(i, { authMode: 'steps' })
        else patchUser(i, { authMode: 'recipe', recipe: v.slice('recipe:'.length) })
    }
    return (
        <div style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', margin: '6px 0' }}>
                users
            </div>
            {users.map((u, i) => (
                <div key={u.id} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                            value={u.name}
                            placeholder="name"
                            onChange={e => patchUser(i, { name: e.target.value })}
                            style={{ width: 130 }}
                        />
                        <label className="muted" style={{ fontSize: 12 }}>
                            layer
                            <select value={u.layer} onChange={e => patchUser(i, { layer: e.target.value })} style={{ marginLeft: 6 }}>
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
                            <select value={authValue(u)} onChange={e => onAuth(i, e.target.value)} style={{ marginLeft: 6 }}>
                                <option value="">anonymous</option>
                                {/* an imported recipe may not be saved locally — keep it selectable */}
                                {u.authMode === 'recipe' && u.recipe && !recipes.some(r => r.name === u.recipe) && (
                                    <option value={`recipe:${u.recipe}`}>{u.recipe} (not saved)</option>
                                )}
                                {recipes.map(r => (
                                    <option key={r.name} value={`recipe:${r.name}`}>
                                        {r.name}
                                    </option>
                                ))}
                                <option value="__steps__">inline login steps</option>
                            </select>
                        </label>
                        {u.authMode === 'recipe' && (
                            <input
                                value={u.with}
                                placeholder='with (JSON): { "phone": "…" }'
                                className="mono"
                                onChange={e => patchUser(i, { with: e.target.value })}
                                style={{ flex: 1, minWidth: 160, fontSize: 12 }}
                            />
                        )}
                        {users.length > 1 && (
                            <button onClick={() => setUsers(us => us.filter((_, j) => j !== i))} aria-label="remove user">
                                ×
                            </button>
                        )}
                    </div>
                    {u.authMode === 'steps' && (
                        <div style={{ marginLeft: 16, marginTop: 8, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
                            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
                                login steps (run on {u.name}'s session before the scenario steps)
                            </div>
                            {u.authSteps.map((as, k) => (
                                <StepCard
                                    key={as.id}
                                    st={as}
                                    index={k}
                                    userNames={userNames}
                                    methodNames={methodNames}
                                    ready={ready}
                                    res={results[as.id]}
                                    collapsed={false}
                                    hideAs
                                    hideCollapse
                                    onToggle={() => {}}
                                    patch={(id, p) => setAuthSteps(i, s => s.map(x => (x.id === id ? { ...x, ...p } : x)))}
                                    move={(id, d) =>
                                        setAuthSteps(i, s => {
                                            const a = s.findIndex(x => x.id === id)
                                            const b = a + d
                                            if (b < 0 || b >= s.length) return s
                                            const c = [...s]
                                            ;[c[a], c[b]] = [c[b]!, c[a]!]
                                            return c
                                        })
                                    }
                                    remove={() => setAuthSteps(i, s => s.filter(x => x.id !== as.id))}
                                />
                            ))}
                            <button onClick={() => setAuthSteps(i, s => [...s, emptyStep(u.name, nid)])}>
                                <Icon name="plus" /> add login step
                            </button>
                        </div>
                    )}
                </div>
            ))}
            <button onClick={() => setUsers(us => [...us, emptyUser(`user${us.length + 1}`, nid)])}>
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
    hideAs = false,
    hideCollapse = false,
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
    hideAs?: boolean
    hideCollapse?: boolean
}) {
    const recipes = listRecipes()
    return (
        <div className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: collapsed ? 0 : 8, flexWrap: 'wrap' }}>
                {!hideCollapse && (
                    <button onClick={onToggle} aria-label="collapse" className="iconbtn" style={{ width: 26, height: 26 }}>
                        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} />
                    </button>
                )}
                <span className="id">#{index + 1}</span>
                {!hideAs && (
                    <>
                        <span className="muted" style={{ fontSize: 12 }}>as</span>
                        <select value={st.as} onChange={e => patch(st.id, { as: e.target.value })}>
                            {userNames.map(n => (
                                <option key={n} value={n}>
                                    {n}
                                </option>
                            ))}
                        </select>
                    </>
                )}
                <select value={st.kind} onChange={e => patch(st.id, { kind: e.target.value as Kind })}>
                    <option value="invoke">invoke</option>
                    <option value="expectUpdate">expectUpdate</option>
                    <option value="recipe">recipe</option>
                </select>
                {collapsed && (
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text2)' }}>
                        {st.kind === 'invoke' ? st.method || '—' : st.kind === 'recipe' ? `recipe ${st.recipe || '—'}` : st.expect || 'update'}
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
                            <MethodPicker
                                methods={methodNames}
                                value={st.method}
                                onChange={m => patch(st.id, { method: m, value: { _: m } })}
                            />
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
                            {st.expectMode === 'error' ? (
                                <input
                                    value={st.errorMessage}
                                    placeholder="error message (e.g. PHONE_CODE_INVALID) — optional"
                                    className="mono"
                                    onChange={e => patch(st.id, { errorMessage: e.target.value })}
                                    style={{ width: '100%', marginTop: 6, fontSize: 12 }}
                                />
                            ) : (
                                <input
                                    value={st.matchSpec}
                                    placeholder="match fields: data = hello, foo.bar = 42 — optional"
                                    className="mono"
                                    onChange={e => patch(st.id, { matchSpec: e.target.value })}
                                    style={{ width: '100%', marginTop: 6, fontSize: 12 }}
                                />
                            )}
                            <input
                                value={st.capture}
                                placeholder="capture: scopeKey = result.path, … — use later as ${scopeKey}"
                                className="mono"
                                onChange={e => patch(st.id, { capture: e.target.value })}
                                style={{ width: '100%', marginTop: 6, fontSize: 12 }}
                            />
                        </>
                    ) : st.kind === 'recipe' ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <select value={st.recipe} onChange={e => patch(st.id, { recipe: e.target.value })}>
                                <option value="">
                                    {recipes.length ? 'choose a recipe…' : 'no recipes — author one in ▸ auth recipes'}
                                </option>
                                {st.recipe && !recipes.some(r => r.name === st.recipe) && (
                                    <option value={st.recipe}>{st.recipe} (not saved)</option>
                                )}
                                {recipes.map(r => (
                                    <option key={r.name} value={r.name}>
                                        {r.name}
                                    </option>
                                ))}
                            </select>
                            <input
                                value={st.with}
                                placeholder='with (JSON): { "code": "…" }'
                                className="mono"
                                onChange={e => patch(st.id, { with: e.target.value })}
                                style={{ flex: 1, minWidth: 160, fontSize: 12 }}
                            />
                        </div>
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
                            <input
                                value={st.matchSpec}
                                placeholder="match fields: update.wallet_id = w1, … — optional"
                                className="mono"
                                onChange={e => patch(st.id, { matchSpec: e.target.value })}
                                style={{ width: '100%', marginTop: 6, fontSize: 12 }}
                            />
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

/** Check a decoded value against an `_` constructor + extra `path = value` match fields. */
function matchAll(
    obj: BObject | undefined,
    expectCtor: string,
    matchSpec: string,
    scope: Scope,
): { ok: boolean; reason?: string } {
    if (expectCtor && obj?._ !== expectCtor) return { ok: false, reason: `expected ${expectCtor}, got ${obj?._ ?? '∅'}` }
    for (const [path, rawVal] of parsePairs(matchSpec)) {
        const want = scope.interpolate(rawVal)
        const got = getByPath(obj, path)
        if (String(got) !== String(want)) return { ok: false, reason: `${path}: expected ${String(want)}, got ${String(got)}` }
    }
    return { ok: true }
}

async function runStep(
    st: Step,
    s: BrowserSession,
    scope: Scope,
    setResults: (f: (p: Record<number, RunResult>) => Record<number, RunResult>) => void,
    line: (text: string, kind?: LogLine['kind']) => void,
    tag: string,
): Promise<void> {
    const set = (r: RunResult): void => setResults(p => ({ ...p, [st.id]: r }))
    // capture result fields into the scope for later `${...}` references
    const capture = (result: BObject): void => {
        for (const [key, path] of parsePairs(st.capture)) {
            scope.set(key, getByPath(result, path))
            line(`  captured ${key} = ${JSON.stringify(scope.get(key))}`)
        }
    }

    if (st.kind === 'recipe') {
        if (!st.recipe) return
        const recipe = listRecipes().find(r => r.name === st.recipe)
        if (!recipe) {
            set({ status: 'err', text: `recipe "${st.recipe}" not found` })
            line(`✕ ${tag}: recipe "${st.recipe}" not found`, 'err')
            return
        }
        try {
            const extra = st.with?.trim() ? (scope.interpolate(JSON.parse(st.with)) as Record<string, unknown>) : {}
            const rScope = await runRecipeCode(recipe, s, msg => line(`  ${msg}`), extra)
            for (const [k, v] of Object.entries(rScope)) scope.set(k, v)
            set({ status: 'ok', text: `recipe ${st.recipe}`, detail: Object.keys(rScope).length ? jsonView(rScope as BValue) : undefined })
            line(`✓ ${tag}`, 'ok')
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            set({ status: 'err', text: msg })
            line(`✕ ${tag}: ${msg}`, 'err')
        }
        return
    }

    if (st.kind === 'expectUpdate') {
        const pred = (u: BObject): boolean => matchAll(u, st.expect, st.matchSpec, scope).ok
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
                const codeOk = !st.expect || String(e.code) === st.expect
                const msgOk = !st.errorMessage || e.message === st.errorMessage
                const ok = codeOk && msgOk
                const want = [st.expect && `code ${st.expect}`, st.errorMessage && `"${st.errorMessage}"`].filter(Boolean).join(' ')
                set({
                    status: ok ? 'ok' : 'mismatch',
                    text: ok ? `rpc_error ${e.code} ${e.message}` : `expected ${want}, got ${e.code} ${e.message}`,
                    msgId,
                })
                line(`${ok ? '✓' : '✕'} ${tag} → msg_id ${msgId}: rpc_error ${e.code} ${e.message}`, ok ? 'ok' : 'err')
            } else {
                const msg = e instanceof Error ? e.message : String(e)
                set({ status: 'err', text: msg, msgId })
                line(`✕ ${tag} → msg_id ${msgId}: ${msg}`, 'err')
            }
        }
        return
    }
    try {
        const r = (await s.invoke(st.method, params, { onSent })) as BObject
        const m = matchAll(r, st.expect, st.matchSpec, scope)
        set({
            status: m.ok ? 'ok' : 'mismatch',
            text: m.ok ? (r?._ ?? '∅') : m.reason!,
            detail: jsonView(r as BValue),
            msgId,
        })
        line(`${m.ok ? '✓' : '✕'} ${tag} → msg_id ${msgId}: ${m.ok ? (r?._ ?? '∅') : m.reason}`, m.ok ? 'ok' : 'err')
        if (m.ok) capture(r)
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
    if (st.label) return st.label
    if (st.kind === 'invoke') return st.method || 'invoke'
    if (st.kind === 'recipe') return `recipe ${st.recipe || ''}`.trim()
    return `expectUpdate ${st.expect || ''}`.trim()
}

/** Type-to-filter method picker. A native <select> is unusable with hundreds of
 *  methods, so this is a combobox: focus to open, type to filter, click to choose. */
function MethodPicker({ methods, value, onChange }: { methods: string[]; value: string; onChange: (m: string) => void }) {
    const [open, setOpen] = useState(false)
    const [q, setQ] = useState('')
    const LIMIT = 60
    const all = useMemo(() => {
        const ql = q.trim().toLowerCase()
        return ql ? methods.filter(m => m.toLowerCase().includes(ql)) : methods
    }, [methods, q])
    const shown = all.slice(0, LIMIT)
    return (
        <div className="combobox" style={{ marginBottom: 8 }}>
            <input
                value={open ? q : value}
                placeholder="— method — (type to filter)"
                onFocus={() => {
                    setOpen(true)
                    setQ('')
                }}
                onChange={e => {
                    setQ(e.target.value)
                    setOpen(true)
                }}
                onBlur={() => window.setTimeout(() => setOpen(false), 150)}
                style={{ width: '100%' }}
            />
            {open && (
                <div className="combobox-list">
                    {shown.length === 0 ? (
                        <div className="combobox-more">no methods match “{q}”</div>
                    ) : (
                        shown.map(m => (
                            <div
                                key={m}
                                className={'combobox-opt' + (m === value ? ' on' : '')}
                                // onMouseDown (not onClick) so it fires before the input's blur closes the list
                                onMouseDown={e => {
                                    e.preventDefault()
                                    onChange(m)
                                    setOpen(false)
                                    setQ('')
                                }}
                            >
                                {m}
                            </div>
                        ))
                    )}
                    {all.length > shown.length && (
                        <div className="combobox-more">… {all.length - shown.length} more — keep typing to narrow</div>
                    )}
                </div>
            )}
        </div>
    )
}
