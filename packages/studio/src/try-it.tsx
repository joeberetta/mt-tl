import { useEffect, useMemo, useState } from 'react'
import { Icon } from './icon.js'
import { useSession } from './session.js'
import { FieldsEditor } from './field-input.js'
import { RpcError } from './client/browser-session.js'
import { Scope } from './client/scope.js'
import { fmtMsgId } from './client/bytes.js'
import type { BObject, BValue } from './client/codec.js'

const toHex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')

interface TryResult {
    ok: boolean
    result?: BObject
    error?: { code: number; message: string }
    ms: number
    reqBytes: number
    msgId: string
}
const paramsOf = (value: BObject): Record<string, unknown> => {
    const { _: _tag, ...rest } = value
    return rest
}

export function jsonView(v: BValue): string {
    return JSON.stringify(
        v,
        (_k, val) => (val instanceof Uint8Array ? `0x${toHex(val)}` : typeof val === 'bigint' ? val.toString() : val),
        2,
    )
}

export function yamlValue(v: BValue): string {
    if (v instanceof Uint8Array) return `!bytes hex:${toHex(v)}`
    if (Array.isArray(v)) {
        if (v.every(x => typeof x === 'number' || typeof x === 'string')) return `[${v.map(yamlValue).join(', ')}]`
        return '\n' + v.map(x => `      - ${yamlValue(x).replace(/\n/g, '\n        ')}`).join('\n')
    }
    if (v && typeof v === 'object' && '_' in v) {
        const o = v as BObject
        const inner = Object.keys(o)
            .filter(k => k !== '_')
            .map(k => `${k}: ${yamlValue(o[k])}`)
            .join(', ')
        return `{ _: ${o._}${inner ? ', ' + inner : ''} }`
    }
    if (typeof v === 'string') return /^[\w.+-]*$/.test(v) ? v : JSON.stringify(v)
    return String(v)
}

function yamlView(method: string, value: BObject, resultType: string): string {
    const params = Object.keys(value).filter(k => k !== '_')
    const lines = ['- invoke:', `    method: ${method}`]
    if (params.length) {
        lines.push('    params:')
        for (const k of params) lines.push(`      ${k}: ${yamlValue(value[k])}`)
    }
    lines.push(`    expect: { _: ${resultType} }`)
    return lines.join('\n')
}

type Fmt = 'json' | 'yaml' | 'bytes'

/**
 * The interactive request runner: a typed editor for a method's params, a live
 * preview (request JSON / scenario YAML / wire bytes — all computed by the real
 * browser codec, no server needed), and a "send" that runs the encrypted call
 * over the shared session. Used on method pages (the per-method "try it").
 */
export function RequestRunner({ method }: { method: string }) {
    const { sess, session, status } = useSession()
    const [ready, setReady] = useState(!!sess.codec)
    const [loadErr, setLoadErr] = useState<string>()
    const [value, setValue] = useState<BObject>({ _: method })
    const [fmt, setFmt] = useState<Fmt>('json')
    const [busy, setBusy] = useState(false)
    const [res, setRes] = useState<TryResult>()
    const [callErr, setCallErr] = useState<string>()

    useEffect(() => {
        setValue({ _: method })
        setRes(undefined)
        setCallErr(undefined)
    }, [method])

    useEffect(() => {
        sess.loadWire()
            .then(() => setReady(true))
            .catch(e => setLoadErr(e instanceof Error ? e.message : String(e)))
    }, [sess])

    const def = ready ? sess.defsByName.get(method) : undefined
    const resultType = def?.type ?? 'Object'

    const preview = useMemo(() => {
        if (!ready) return ''
        if (fmt === 'json') return jsonView(value)
        if (fmt === 'yaml') return yamlView(method, value, resultType)
        try {
            const bytes = sess.encode(value)
            return `${bytes.length} bytes\n${toHex(bytes).replace(/(.{2})/g, '$1 ').trim()}`
        } catch (e) {
            return `cannot encode yet — ${e instanceof Error ? e.message : String(e)}`
        }
    }, [ready, fmt, value, method, resultType, sess])

    if (loadErr) return <div className="callout danger">try-it unavailable — {loadErr}</div>
    if (!ready) return <div className="muted">loading wire schema…</div>
    if (!def) return <div className="muted">“{method}” is not in wire.json (regenerate with mt-tl-studio build)</div>

    const connected = status === 'connected' && !!session
    const send = async (): Promise<void> => {
        if (!session) return
        setBusy(true)
        setRes(undefined)
        setCallErr(undefined)
        let msgId = ''
        let reqBytes = 0
        try {
            reqBytes = sess.encode(value).length
        } catch {
            /* preview-only */
        }
        const t0 = performance.now()
        try {
            // resolve ${rand.long} / ${now} / … just before sending
            const params = new Scope().interpolate(paramsOf(value)) as Record<string, unknown>
            const result = await session.invoke(method, params, { onSent: id => (msgId = fmtMsgId(id)) })
            setRes({ ok: true, result, ms: Math.round(performance.now() - t0), reqBytes, msgId })
        } catch (e) {
            if (e instanceof RpcError) {
                setRes({ ok: false, error: { code: e.code, message: e.message }, ms: Math.round(performance.now() - t0), reqBytes, msgId })
            } else {
                setCallErr(e instanceof Error ? e.message : String(e))
            }
        } finally {
            setBusy(false)
        }
    }
    const download = (): void => {
        const blob = new Blob([yamlView(method, value, resultType) + '\n'], { type: 'text/yaml' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${method.replace(/\W+/g, '_')}.scenario.yaml`
        a.click()
        URL.revokeObjectURL(a.href)
    }

    return (
        <div className="runner">
            <FieldsEditor defName={method} value={value} onChange={setValue} />

            <div className="runner-actions">
                <button
                    onClick={send}
                    disabled={!connected || busy}
                    title={connected ? '' : 'connect a server in the bar above'}
                    style={connected ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
                >
                    <Icon name={busy ? 'loader-2' : 'player-play'} />{' '}
                    {busy ? 'sending…' : 'send'}
                </button>
                {!connected && <span className="muted" style={{ fontSize: 12 }}>connect above to send · preview works offline</span>}
                <span style={{ marginLeft: 'auto' }} />
                <button onClick={download} title="export as a scenario step">
                    <Icon name="download" /> .yaml
                </button>
                <div className="seg">
                    {(['json', 'yaml', 'bytes'] as Fmt[]).map(f => (
                        <button key={f} className={fmt === f ? 'on' : ''} onClick={() => setFmt(f)}>
                            {f === 'json' ? 'request' : f}
                        </button>
                    ))}
                </div>
            </div>

            <pre className="preview">{preview}</pre>

            {callErr && <div className="callout danger">{callErr}</div>}
            {res && <ResultCard res={res} />}
        </div>
    )
}

function ResultCard({ res }: { res: TryResult }) {
    const meta = (
        <span className="id" style={{ marginLeft: 'auto' }}>
            msg_id {res.msgId || '—'} · {res.ms} ms · {res.reqBytes} B sent
        </span>
    )
    if (!res.ok && res.error) {
        return (
            <div className="result err">
                <div className="result-head">
                    <span style={{ color: 'var(--danger)' }} className="mono">
                        <Icon name="alert-triangle" /> rpc_error
                    </span>
                    {meta}
                </div>
                <div className="mono" style={{ color: 'var(--danger)' }}>
                    {res.error.code} {res.error.message}
                </div>
            </div>
        )
    }
    return (
        <div className="result ok">
            <div className="result-head">
                <span style={{ color: 'var(--ok)' }} className="mono">
                    <Icon name="check" /> rpc_result
                </span>
                {meta}
            </div>
            <pre className="preview" style={{ margin: 0 }}>
                {jsonView(res.result as BValue)}
            </pre>
        </div>
    )
}
