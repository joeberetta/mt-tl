import { useState } from 'react'
import { Icon } from './icon.js'
import { useSession } from './session.js'
import { listRecipes, localRecipes, isBuiltin, saveRecipe, deleteRecipe, runRecipeCode, type Recipe } from './recipes.js'

const STARTER = `// Auth recipe — runs on the connected session before your scenario's steps.
// It's a real ES module, so import your own crypto and sign challenges at runtime:
//   import { sign } from 'https://esm.sh/your-ecc-lib'
//
// ctx.invoke(method, params) -> decoded result | throws on rpc_error
// ctx.args  -> the JSON below (e.g. phone, seed/secret)
// ctx.set(k, v) / ctx.get(k) -> share login results
// ctx.log(...) -> progress lines

export default async (ctx) => {
  // const sent = await ctx.invoke('crypto.sendCode', { phone: ctx.args.phone })
  // const signature = sign(sent.challenge, ctx.args.seed)
  // const auth = await ctx.invoke('crypto.signIn', { phone: ctx.args.phone, sign: signature })
  // ctx.set('userId', auth.user.id)
  ctx.log('implement your login flow, then ctx.set the results you need')
}
`

const blank = (): Recipe => ({ name: '', code: STARTER, args: '{\n  "phone": "+15551234",\n  "seed": ""\n}' })

/** Author + test login recipes (consumer-written ES modules). Stored locally. */
export function RecipesPage() {
    const { session, status } = useSession()
    const [recipes, setRecipes] = useState<Recipe[]>(() => listRecipes())
    const [draft, setDraft] = useState<Recipe>(() => listRecipes()[0] ?? blank())
    const [log, setLog] = useState<string[]>([])
    const [err, setErr] = useState<string>()
    const [busy, setBusy] = useState(false)
    const connected = status === 'connected'

    const refresh = (): void => setRecipes(listRecipes())
    const save = (): void => {
        if (!draft.name.trim()) {
            setErr('give the recipe a name')
            return
        }
        saveRecipe(draft)
        refresh()
        setErr(undefined)
    }
    const remove = (name: string): void => {
        deleteRecipe(name)
        refresh()
        if (draft.name === name) setDraft(blank())
    }
    const test = async (): Promise<void> => {
        if (!session) {
            setErr('connect a server in the bar above first')
            return
        }
        setBusy(true)
        setErr(undefined)
        setLog([])
        try {
            const scope = await runRecipeCode(draft, session, line => setLog(l => [...l, line]))
            setLog(l => [...l, '✓ done · scope = ' + JSON.stringify(scope)])
        } catch (e) {
            // Errors thrown inside the imported recipe module (incl. its esm.sh deps)
            // surface here with a stack — also log to the console for the devtools.
            console.error('recipe failed:', e)
            const msg = e instanceof Error ? e.message : String(e)
            const stack = e instanceof Error && e.stack ? '\n' + e.stack : ''
            setErr(msg)
            setLog(l => [...l, '✕ ' + msg + stack])
        } finally {
            setBusy(false)
        }
    }

    return (
        <main className="content" style={{ maxWidth: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="badge">recipes</span>
                <h1>Auth recipes</h1>
            </div>
            <p className="muted">
                A recipe is your own login flow as an ES module — it runs on a connected session, imports whatever
                crypto you need, and signs at runtime. Nothing is baked in. Saved in this browser.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '200px minmax(0,1fr)', gap: 18, alignItems: 'start', marginTop: 12 }}>
                <div>
                    <div className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
                        saved
                    </div>
                    {recipes.length === 0 && <div className="muted" style={{ fontSize: 13 }}>none yet</div>}
                    {recipes.map(r => {
                        const builtin = isBuiltin(r.name)
                        const hasLocal = localRecipes().some(l => l.name === r.name)
                        return (
                            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                                <button
                                    onClick={() => setDraft(r)}
                                    style={{ flex: 1, textAlign: 'left', borderColor: draft.name === r.name ? 'var(--accent)' : undefined }}
                                    title={builtin ? 'built-in (bundled) — edit + save to fork it locally' : ''}
                                >
                                    {r.name}
                                    {builtin && <span className="badge" style={{ marginLeft: 6, fontSize: 10 }}>built-in</span>}
                                </button>
                                {/* Only a LOCAL recipe (or a local fork of a built-in) can be deleted;
                                    a pure bundled recipe has nothing local to remove. */}
                                {(!builtin || hasLocal) && (
                                    <button onClick={() => remove(r.name)} aria-label="delete" title={builtin ? 'remove local fork (restores built-in)' : 'delete'}>
                                        <Icon name="trash" />
                                    </button>
                                )}
                            </div>
                        )
                    })}
                    <button onClick={() => setDraft(blank())} style={{ marginTop: 6 }}>
                        <Icon name="plus" /> new recipe
                    </button>
                </div>

                <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                        <input
                            value={draft.name}
                            placeholder="recipe name (e.g. eos-login)"
                            onChange={e => setDraft({ ...draft, name: e.target.value })}
                            style={{ width: 240 }}
                        />
                        <button onClick={save}>
                            <Icon name="device-floppy" /> save
                        </button>
                        <button
                            onClick={test}
                            disabled={!connected || busy}
                            title={connected ? '' : 'connect a server in the bar above'}
                            style={connected ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                        >
                            <Icon name={busy ? 'loader-2' : 'player-play'} /> test run
                        </button>
                        {!connected && <span className="muted" style={{ fontSize: 12 }}>connect above to test</span>}
                    </div>

                    <div className="muted" style={{ fontSize: 12, margin: '4px 0' }}>module (export default async (ctx) =&gt; …)</div>
                    <textarea
                        value={draft.code}
                        onChange={e => setDraft({ ...draft, code: e.target.value })}
                        rows={16}
                        style={{ width: '100%' }}
                        spellCheck={false}
                    />

                    <div className="muted" style={{ fontSize: 12, margin: '8px 0 4px' }}>
                        ctx.args (JSON) — the secret/seed lives here · saved locally
                    </div>
                    <textarea
                        value={draft.args}
                        onChange={e => setDraft({ ...draft, args: e.target.value })}
                        rows={4}
                        style={{ width: '100%' }}
                        spellCheck={false}
                    />

                    {err && <div className="callout danger" style={{ marginTop: 10 }}>{err}</div>}
                    {log.length > 0 && (
                        <pre className="preview" style={{ marginTop: 10 }}>
                            {log.join('\n')}
                        </pre>
                    )}
                </div>
            </div>
        </main>
    )
}
