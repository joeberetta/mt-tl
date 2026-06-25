import { useEffect, useRef, useState } from 'react'
import { Icon } from './icon.js'
import { useSession } from './session.js'
import { jsonView } from './value-format.js'

interface UpdLine {
    id: number
    at: string
    name: string
    json: string
}

/**
 * Background updates listener — runs on the SHARED connection (set up + logged in
 * via the connection bar). Subscribes to every pushed update and logs it; stop on
 * a timeout or the Stop button. Logs are copyable / downloadable.
 */
export function ListenPage() {
    const { session, status, authedVia } = useSession()
    const [updates, setUpdates] = useState<UpdLine[]>([])
    const [listening, setListening] = useState(false)
    const [autoStopSec, setAutoStopSec] = useState('')
    const [expanded, setExpanded] = useState<Record<number, boolean>>({}) // manual per-card overrides
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const idRef = useRef(0)
    const connected = status === 'connected' && !!session
    const toggle = (id: number, isExp: boolean): void => setExpanded(e => ({ ...e, [id]: !isExp }))

    const stop = (): void => {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = null
        session?.stopListening()
        setListening(false)
    }
    const start = (): void => {
        if (!session) return
        setUpdates([])
        setExpanded({})
        session.listen(u =>
            setUpdates(list => [...list, { id: ++idRef.current, at: new Date().toLocaleTimeString(), name: u._, json: jsonView(u) }]),
        )
        setListening(true)
        if (autoStopSec && Number(autoStopSec) > 0) timerRef.current = setTimeout(stop, Number(autoStopSec) * 1000)
    }

    // Stop listening when leaving the page (don't close the shared session).
    useEffect(
        () => () => {
            if (timerRef.current) clearTimeout(timerRef.current)
            session?.stopListening()
        },
        [session],
    )

    const text = updates.map(u => `[${u.at}] ${u.name}\n${u.json}`).join('\n\n')
    const download = (): void => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
        a.download = 'updates.log'
        a.click()
        URL.revokeObjectURL(a.href)
    }

    return (
        <main className="content" style={{ maxWidth: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="badge">listen</span>
                <h1>Updates listener</h1>
            </div>
            <p className="muted">
                Watch every server-pushed update on the shared connection. Connect (and, if you need a logged-in user,
                “run login”) in the connection bar above — this page just listens.
            </p>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0' }}>
                <span className="muted" style={{ fontSize: 13 }}>
                    {connected ? (
                        authedVia ? (
                            <>
                                <Icon name="user-check" /> connected · auth {authedVia}
                            </>
                        ) : (
                            <>
                                <Icon name="user-off" /> connected · anonymous
                            </>
                        )
                    ) : (
                        'not connected'
                    )}
                </span>
                <label className="muted" style={{ fontSize: 12 }}>
                    auto-stop (s)
                    <input
                        type="number"
                        value={autoStopSec}
                        onChange={e => setAutoStopSec(e.target.value)}
                        placeholder="∞"
                        style={{ width: 80, marginLeft: 6 }}
                        disabled={listening}
                    />
                </label>
                {listening ? (
                    <button onClick={stop} style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
                        <Icon name="player-stop" /> stop
                    </button>
                ) : (
                    <button
                        onClick={start}
                        disabled={!connected}
                        title={connected ? '' : 'connect in the bar above'}
                        style={connected ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                    >
                        <Icon name="player-play" /> start listening
                    </button>
                )}
                <span className="muted" style={{ fontSize: 12 }}>
                    {listening ? `listening · ${updates.length} update${updates.length === 1 ? '' : 's'}` : ''}
                </span>
                {updates.length > 0 && (
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button onClick={() => void navigator.clipboard?.writeText(text)}>
                            <Icon name="copy" /> copy
                        </button>
                        <button onClick={download}>
                            <Icon name="download" /> .log
                        </button>
                    </span>
                )}
            </div>

            {!connected && (
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                    connect a server in the connection bar above to listen
                </div>
            )}

            {updates.length === 0 ? (
                <div className="callout">No updates yet{listening ? ' — waiting…' : ''}.</div>
            ) : (
                updates
                    .slice()
                    .reverse()
                    .map((u, i) => {
                        const newest = i === 0 // only the newest is open by default; older collapse
                        const isExp = u.id in expanded ? expanded[u.id]! : newest
                        return (
                            <div className="result ok" key={u.id} style={{ marginBottom: 8 }}>
                                <div
                                    className="result-head"
                                    style={{ cursor: 'pointer', marginBottom: isExp ? 8 : 0 }}
                                    onClick={() => toggle(u.id, isExp)}
                                >
                                    <Icon name={isExp ? 'chevron-down' : 'chevron-right'} />
                                    <span className="mono" style={{ color: 'var(--ok)' }}>
                                        {u.name}
                                    </span>
                                    <span className="id" style={{ marginLeft: 'auto' }}>
                                        {u.at}
                                    </span>
                                </div>
                                {isExp && (
                                    <pre className="preview" style={{ margin: 0 }}>
                                        {u.json}
                                    </pre>
                                )}
                            </div>
                        )
                    })
            )}
        </main>
    )
}
