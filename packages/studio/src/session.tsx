import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './icon.js'
import { StudioSession } from './client/studio-session.js'
import { BrowserSession } from './client/browser-session.js'
import { listRecipes, runRecipeCode } from './recipes.js'

export type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface SessionCtx {
    sess: StudioSession
    /** The connected default session for the per-method "try it" + the connbar recipe. */
    session: BrowserSession | null
    status: ConnStatus
    err?: string
    url: string
    setUrl: (v: string) => void
    pem: string
    setPem: (v: string) => void
    /** Telegram api_id — sent in initConnection (required by real Telegram). */
    apiId: string
    setApiId: (v: string) => void
    /** Telegram api_hash — passed to auth recipes as ctx.args.api_hash. */
    apiHash: string
    setApiHash: (v: string) => void
    /** Use the obfuscated WS transport (required to reach real Telegram). */
    obfuscated: boolean
    setObfuscated: (v: boolean) => void
    connect: (layer?: number) => Promise<void>
    reset: () => void
    authedVia?: string
    runRecipe: (name: string, withArgs?: Record<string, unknown>) => Promise<void>
    /** Open a fresh per-user session (own handshake + optional layer) off the shared url+key. */
    openUser: (opts?: { layer?: number }) => Promise<BrowserSession>
}

const LS_URL = 'mt-tl-studio.url'
const LS_PEM = 'mt-tl-studio.pem'
const LS_API_ID = 'mt-tl-studio.apiId'
const LS_API_HASH = 'mt-tl-studio.apiHash'
const LS_OBFUSCATED = 'mt-tl-studio.obfuscated'
const load = (key: string, fallback: string): string => {
    try {
        return localStorage.getItem(key) ?? fallback
    } catch {
        return fallback
    }
}
const save = (key: string, value: string): void => {
    try {
        localStorage.setItem(key, value)
    } catch {
        /* ignore */
    }
}

const Ctx = createContext<SessionCtx | null>(null)

export function useSession(): SessionCtx {
    const c = useContext(Ctx)
    if (!c) throw new Error('useSession outside provider')
    return c
}

export function SessionProvider({ children }: { children: ReactNode }) {
    const [sess] = useState(() => new StudioSession())
    const [session, setSession] = useState<BrowserSession | null>(null)
    const [status, setStatus] = useState<ConnStatus>('disconnected')
    const [err, setErr] = useState<string>()
    const [url, setUrlState] = useState(() => load(LS_URL, 'ws://localhost:9000'))
    const [pem, setPemState] = useState(() => load(LS_PEM, ''))
    const [apiId, setApiIdState] = useState(() => load(LS_API_ID, ''))
    const [apiHash, setApiHashState] = useState(() => load(LS_API_HASH, ''))
    const [obfuscated, setObfuscatedState] = useState(() => load(LS_OBFUSCATED, '') === '1')
    const [authedVia, setAuthedVia] = useState<string>()

    // A build can ship `config.json` — seed the connbar from it so a consumer's team
    // doesn't paste url/key by hand. The user's own saved value (localStorage) always
    // wins; config is just the default for fresh visitors.
    useEffect(() => {
        fetch('./config.json')
            .then(r => (r.ok ? r.json() : null))
            .then(
                (
                    c: {
                        defaultUrl?: string
                        defaultPem?: string
                        defaultApiId?: number | string
                        defaultObfuscated?: boolean
                    } | null,
                ) => {
                    if (!c) return
                    if (localStorage.getItem(LS_URL) == null && c.defaultUrl) setUrlState(c.defaultUrl)
                    if (localStorage.getItem(LS_PEM) == null && c.defaultPem) setPemState(c.defaultPem)
                    if (localStorage.getItem(LS_API_ID) == null && c.defaultApiId != null) setApiIdState(String(c.defaultApiId))
                    if (localStorage.getItem(LS_OBFUSCATED) == null && c.defaultObfuscated != null)
                        setObfuscatedState(!!c.defaultObfuscated)
                },
            )
            .catch(() => {})
    }, [])

    // Persist url + key so they survive a refresh (A3).
    const setUrl = (v: string): void => {
        setUrlState(v)
        save(LS_URL, v)
    }
    const setPem = (v: string): void => {
        setPemState(v)
        save(LS_PEM, v)
    }
    const setApiId = (v: string): void => {
        setApiIdState(v)
        save(LS_API_ID, v)
    }
    const setApiHash = (v: string): void => {
        setApiHashState(v)
        save(LS_API_HASH, v)
    }
    const setObfuscated = (v: boolean): void => {
        setObfuscatedState(v)
        save(LS_OBFUSCATED, v ? '1' : '0')
    }

    const openUser = async (opts: { layer?: number } = {}): Promise<BrowserSession> => {
        if (!url) throw new Error('set the server URL in the connection bar')
        await sess.loadWire()
        if (!pem) throw new Error('set the server public key (PEM) in the connection bar')
        return BrowserSession.open(url, pem, sess.codec!, {
            layer: opts.layer,
            obfuscated,
            // Real Telegram requires a valid api_id in initConnection; mt-tl ignores it.
            initConnection: apiId.trim() ? { api_id: Number(apiId) } : undefined,
        })
    }

    // The session a close-event should reset (guards a stale old session's onclose
    // firing after a reconnect from wrongly tearing down the new one).
    const liveRef = useRef<BrowserSession | null>(null)

    const connect = async (layer?: number): Promise<void> => {
        setErr(undefined)
        setStatus('connecting')
        setAuthedVia(undefined) // a fresh session is NOT authed (the badge must be honest)
        try {
            // The default try-it session is a BrowserSession (proper pump + msg_container
            // handling) AND negotiates the layer, so the FIRST call is wrapped in
            // invokeWithLayer(initConnection(...)) — real servers require that before
            // business methods, otherwise they never reply (10s timeout).
            const s = await openUser({ layer: layer && layer > 0 ? layer : undefined })
            liveRef.current = s
            s.onClose(() => {
                if (liveRef.current !== s) return // an old session closing — ignore
                liveRef.current = null
                setSession(null)
                setStatus('disconnected')
                setAuthedVia(undefined)
                setErr('server closed the connection')
            })
            setSession(s)
            setStatus('connected')
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
            setStatus('error')
        }
    }
    const reset = (): void => {
        liveRef.current = null
        session?.close()
        setSession(null)
        setStatus('disconnected')
        setErr(undefined)
        setAuthedVia(undefined)
    }
    const runRecipe = async (name: string, withArgs: Record<string, unknown> = {}): Promise<void> => {
        if (!session) throw new Error('connect first')
        const recipe = listRecipes().find(r => r.name === name)
        if (!recipe) throw new Error(`recipe "${name}" not found`)
        // The connbar's api_id/api_hash are available to every recipe as ctx.args
        // (an explicit `with` value still overrides them).
        const creds: Record<string, unknown> = {}
        if (apiId.trim()) creds.api_id = Number(apiId)
        if (apiHash.trim()) creds.api_hash = apiHash.trim()
        await runRecipeCode(recipe, session, undefined, { ...creds, ...withArgs })
        setAuthedVia(name)
    }

    return (
        <Ctx.Provider
            value={{
                sess,
                session,
                status,
                err,
                url,
                setUrl,
                pem,
                setPem,
                apiId,
                setApiId,
                apiHash,
                setApiHash,
                obfuscated,
                setObfuscated,
                connect,
                reset,
                authedVia,
                runRecipe,
                openUser,
            }}
        >
            {children}
        </Ctx.Provider>
    )
}

const DOT: Record<ConnStatus, string> = {
    disconnected: 'var(--text3)',
    connecting: 'var(--accent)',
    connected: 'var(--ok)',
    error: 'var(--danger)',
}

/** Full-width strip under the topbar: one shared connection for every "try it".
 *  `layer` is the studio's selected layer — the default session negotiates it. */
export function ConnectionBar({ layer, route }: { layer?: number; route?: string }) {
    const { status, err, url, setUrl, pem, setPem, apiId, setApiId, apiHash, setApiHash, obfuscated, setObfuscated, connect, reset, authedVia, runRecipe } =
        useSession()
    // The scenario builder authorizes per-user (its own recipe selects), so the shared
    // "run login" row is redundant there — hide it.
    const hideAuth = !!route && route.startsWith('/builder')
    const [open, setOpen] = useState(false)
    const [recipe, setRecipe] = useState('')
    const [recipeWith, setRecipeWith] = useState('')
    const [recipeBusy, setRecipeBusy] = useState(false)
    const [recipeErr, setRecipeErr] = useState<string>()
    const connected = status === 'connected'
    const recipes = connected ? listRecipes() : []

    const doRecipe = async (): Promise<void> => {
        if (!recipe) return
        setRecipeBusy(true)
        setRecipeErr(undefined)
        try {
            const withArgs = recipeWith.trim() ? (JSON.parse(recipeWith) as Record<string, unknown>) : {}
            await runRecipe(recipe, withArgs)
        } catch (e) {
            setRecipeErr(e instanceof Error ? e.message : String(e))
        } finally {
            setRecipeBusy(false)
        }
    }

    return (
        <div className="connbar">
            <div className="connbar-row">
                <span className="conn-dot" style={{ background: DOT[status] }} />
                <span className="muted" style={{ fontSize: 13, minWidth: 92 }}>
                    {status === 'connected'
                        ? 'connected'
                        : status === 'connecting'
                          ? 'connecting…'
                          : status === 'error'
                            ? 'connection failed'
                            : 'not connected'}
                </span>
                <input
                    className="mono"
                    style={{ flex: 1, minWidth: 160 }}
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    disabled={connected}
                    placeholder="ws://your-server:port"
                    aria-label="server url"
                />
                <button onClick={() => setOpen(o => !o)} title="connection settings">
                    <Icon name="key" /> key{pem ? ' ✓' : ''}
                </button>
                {connected ? (
                    <button onClick={reset}>reset</button>
                ) : (
                    <button
                        onClick={() => void connect(layer)}
                        disabled={status === 'connecting'}
                        style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                    >
                        connect
                    </button>
                )}
            </div>
            {connected && !hideAuth && (
                <div className="connbar-row" style={{ marginTop: 8 }}>
                    {authedVia ? (
                        <span style={{ fontSize: 13, color: 'var(--ok)' }}>
                            <Icon name="user-check" /> authorized · {authedVia}
                        </span>
                    ) : (
                        <span className="muted" style={{ fontSize: 13 }}>
                            <Icon name="user-off" /> anonymous
                        </span>
                    )}
                    <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
                        auth recipe
                    </span>
                    <select
                        value={recipe}
                        onChange={e => {
                            setRecipe(e.target.value)
                            // prefill ctx.args from the recipe's saved args, ready to edit (A1)
                            setRecipeWith(listRecipes().find(r => r.name === e.target.value)?.args ?? '')
                        }}
                        style={{ minWidth: 160 }}
                    >
                        <option value="">{recipes.length ? 'choose a recipe…' : 'no recipes — author one in ▸ auth recipes'}</option>
                        {recipes.map(r => (
                            <option key={r.name} value={r.name}>
                                {r.name}
                            </option>
                        ))}
                    </select>
                    {recipe && (
                        <input
                            className="mono"
                            value={recipeWith}
                            onChange={e => setRecipeWith(e.target.value)}
                            placeholder='ctx.args (JSON): { "phone": "…" }'
                            style={{ flex: 1, minWidth: 160, fontSize: 12 }}
                        />
                    )}
                    <button onClick={doRecipe} disabled={!recipe || recipeBusy}>
                        <Icon name={recipeBusy ? 'loader-2' : 'player-play'} /> run login
                    </button>
                </div>
            )}
            {recipeErr && (
                <div className="connbar-panel" style={{ color: 'var(--danger)', fontSize: 12 }}>
                    recipe failed — {recipeErr}
                </div>
            )}
            {open && (
                <div className="connbar-panel">
                    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        server RSA public key (PEM) — clients pin this to encrypt the handshake
                    </div>
                    <textarea
                        rows={4}
                        style={{ width: '100%' }}
                        value={pem}
                        onChange={e => setPem(e.target.value)}
                        placeholder={'-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----'}
                        disabled={connected}
                    />
                    <div className="connbar-row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                            <input
                                type="checkbox"
                                checked={obfuscated}
                                onChange={e => setObfuscated(e.target.checked)}
                                disabled={connected}
                            />
                            obfuscated transport (Telegram)
                        </label>
                        <input
                            className="mono"
                            value={apiId}
                            onChange={e => setApiId(e.target.value)}
                            disabled={connected}
                            placeholder="api_id"
                            aria-label="api id"
                            style={{ width: 110, fontSize: 12 }}
                        />
                        <input
                            className="mono"
                            value={apiHash}
                            onChange={e => setApiHash(e.target.value)}
                            disabled={connected}
                            placeholder="api_hash"
                            aria-label="api hash"
                            style={{ flex: 1, minWidth: 160, fontSize: 12 }}
                        />
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                        auth is per-request: <code>auth: false</code> methods run anonymously; others need a recipe.
                        For real Telegram, enable obfuscated transport, paste its server RSA key + your{' '}
                        <code>api_id</code> (from my.telegram.org); <code>api_id</code>/<code>api_hash</code> reach
                        recipes as <code>ctx.args</code>.
                    </div>
                </div>
            )}
            {err && (
                <div className="connbar-panel" style={{ color: 'var(--danger)', fontSize: 12 }}>
                    {err}
                </div>
            )}
        </div>
    )
}
