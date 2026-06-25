import { useSession } from './session.js'
import { Icon } from './icon.js'
import { hexToBytes } from './client/bytes.js'
import type { BObject, BValue } from './client/codec.js'
import type { TlType } from './client/ir-types.js'

const toHex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
const asObj = (v: BValue): BObject => (v && typeof v === 'object' && '_' in v ? (v as BObject) : { _: '' })

/** Render a typed control for a single TL type. `value`/`onChange` are the field's value. */
function TypeInput({ type, value, onChange }: { type: TlType; value: BValue; onChange: (v: BValue) => void }) {
    switch (type.kind) {
        case 'int':
        case 'double':
            return (
                <input
                    type="text"
                    inputMode="numeric"
                    className="mono"
                    value={value === undefined || value === null ? '' : String(value)}
                    // a `${...}` variable (e.g. ${rand.int}) is kept as a template string —
                    // `type=number` would block it entirely; otherwise coerce to a number.
                    onChange={e => {
                        const v = e.target.value
                        if (/[${}]/.test(v)) return onChange(v)
                        const cleaned = v.replace(/[^0-9.\-]/g, '')
                        onChange(cleaned === '' || cleaned === '-' ? 0 : Number(cleaned))
                    }}
                    placeholder="0 or ${rand.int}"
                    style={{ width: 200 }}
                />
            )
        case 'long':
            return (
                <input
                    type="text"
                    className="mono"
                    value={value === undefined || value === null ? '' : String(value)}
                    // allow a `${...}` template (e.g. ${rand.long}); the old `includes('${')`
                    // guard stripped the `$` before you could type the `{`, so match any of `${}`.
                    onChange={e => {
                        const v = e.target.value
                        onChange(/[${}]/.test(v) ? v : v.replace(/[^0-9-]/g, ''))
                    }}
                    placeholder="0 or ${rand.long}"
                    style={{ width: 200 }}
                />
            )
        case 'string':
            return (
                <input
                    type="text"
                    value={typeof value === 'string' ? value : ''}
                    onChange={e => onChange(e.target.value)}
                    style={{ width: '100%' }}
                />
            )
        case 'bytes':
        case 'int128':
        case 'int256':
            return (
                <div className="ctl">
                    <input
                        type="text"
                        className="mono"
                        value={value instanceof Uint8Array ? toHex(value) : typeof value === 'string' ? value : ''}
                        onChange={e => onChange(hexToBytes(e.target.value.replace(/[^0-9a-fA-F]/g, '')))}
                        placeholder="hex"
                        style={{ flex: 1, minWidth: 160 }}
                    />
                    <span className="chip">hex{type.kind !== 'bytes' ? ` · ${type.kind === 'int128' ? 16 : 32}B` : ''}</span>
                </div>
            )
        case 'bool':
            return (
                <label className="inline">
                    <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />
                    <span className="muted">{value === true ? 'true' : 'false'}</span>
                </label>
            )
        case 'vector':
            return <VectorInput type={type} value={value} onChange={onChange} />
        case 'boxed':
        case 'bare':
            return <NestedObject typeName={type.name} value={value} onChange={onChange} />
        case 'object':
            return (
                <textarea
                    rows={2}
                    className="mono"
                    style={{ width: '100%' }}
                    placeholder='{ "_": "constructorName", … }'
                    value={typeof value === 'string' ? value : value ? JSON.stringify(value) : ''}
                    onChange={e => {
                        try {
                            onChange(JSON.parse(e.target.value))
                        } catch {
                            onChange(e.target.value)
                        }
                    }}
                />
            )
        case 'true':
        case 'flags':
        case 'flag':
            return null // handled by FieldsEditor
    }
}

function VectorInput({ type, value, onChange }: { type: Extract<TlType, { kind: 'vector' }>; value: BValue; onChange: (v: BValue) => void }) {
    const arr = Array.isArray(value) ? value : []
    const setAt = (i: number, v: BValue): void => onChange(arr.map((x, j) => (j === i ? v : x)))
    return (
        <div style={{ width: '100%' }}>
            {arr.map((item, i) => (
                <div className="veritem" key={i}>
                    <div style={{ flex: 1 }}>
                        <TypeInput type={type.inner} value={item} onChange={v => setAt(i, v)} />
                    </div>
                    <button className="iconbtn" aria-label="remove" onClick={() => onChange(arr.filter((_, j) => j !== i))}>
                        <Icon name="trash" />
                    </button>
                </div>
            ))}
            <button onClick={() => onChange([...arr, defaultFor(type.inner)])}>
                <Icon name="plus" /> add item
            </button>
        </div>
    )
}

function NestedObject({ typeName, value, onChange }: { typeName: string; value: BValue; onChange: (v: BValue) => void }) {
    const { sess } = useSession()
    const ctors = sess.ctorsByType.get(typeName) ?? (sess.defsByName.has(typeName) ? [typeName] : [])
    const obj = asObj(value)
    if (ctors.length === 0) {
        return (
            <textarea
                rows={2}
                className="mono"
                style={{ width: '100%' }}
                placeholder={`{ "_": "<${typeName}>", … }`}
                value={typeof value === 'string' ? value : value ? JSON.stringify(value) : ''}
                onChange={e => {
                    try {
                        onChange(JSON.parse(e.target.value))
                    } catch {
                        onChange(e.target.value)
                    }
                }}
            />
        )
    }
    return (
        <div style={{ width: '100%' }}>
            <select
                value={obj._ || ''}
                onChange={e => onChange({ _: e.target.value })}
                style={{ minWidth: 220, marginBottom: 6 }}
            >
                <option value="" disabled>
                    choose {typeName}…
                </option>
                {ctors.map(c => (
                    <option key={c} value={c}>
                        {c}
                    </option>
                ))}
            </select>
            {obj._ && (
                <div className="nested">
                    <FieldsEditor defName={obj._} value={obj} onChange={onChange} />
                </div>
            )}
        </div>
    )
}

function defaultFor(t: TlType): BValue {
    switch (t.kind) {
        case 'int':
        case 'double':
            return 0
        case 'long':
            return '0'
        case 'string':
            return ''
        case 'bool':
            return false
        case 'bytes':
        case 'int128':
        case 'int256':
            return new Uint8Array(0)
        case 'vector':
            return []
        case 'boxed':
        case 'bare':
            return { _: '' } // a placeholder object so a nested optional shows its ctor picker
        default:
            return undefined
    }
}

/**
 * The typed editor for a constructor/method's parameters. Renders one row per
 * field with a control matched to its TL type; `flags:#` is hidden (the codec
 * computes it), optional `flags.N?T` fields get an include-toggle, and `?true`
 * flags are a plain checkbox. The emitted `value` is a ready-to-encode BObject.
 */
export function FieldsEditor({
    defName,
    value,
    onChange,
}: {
    defName: string
    value: BObject
    onChange: (v: BObject) => void
}) {
    const { sess } = useSession()
    const def = sess.defsByName.get(defName)
    if (!def) return <div className="muted">unknown type “{defName}” — not in wire.json</div>

    const set = (name: string, v: BValue): void => onChange({ ...value, [name]: v })
    const unset = (name: string): void => {
        const next = { ...value }
        delete next[name]
        onChange(next)
    }

    const rows = def.params.filter(p => p.type.kind !== 'flags')
    if (rows.length === 0) return <div className="muted">no parameters</div>

    return (
        <div className="fields">
            {rows.map(p => {
                const t = p.type
                if (t.kind === 'flag') {
                    // Track presence by key existence, not `!== undefined`: a non-primitive
                    // optional (flags.N?SomeType) may legitimately hold an as-yet-empty value.
                    const included = p.name in value
                    const isTrue = t.inner.kind === 'true'
                    return (
                        <div className="frow" key={p.name}>
                            <div className="fname">
                                {p.name}
                                <span className="tchip">{p.raw}</span>
                            </div>
                            <div className="ctl" style={{ display: 'block' }}>
                                <label className="inline">
                                    <input
                                        type="checkbox"
                                        checked={included}
                                        onChange={e =>
                                            e.target.checked ? set(p.name, isTrue ? true : defaultFor(t.inner)) : unset(p.name)
                                        }
                                    />
                                    <span className="muted">{isTrue ? 'present (true)' : 'include'}</span>
                                </label>
                                {included && !isTrue && (
                                    <div style={{ marginTop: 6 }}>
                                        <TypeInput type={t.inner} value={value[p.name]} onChange={v => set(p.name, v)} />
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                }
                return (
                    <div className="frow" key={p.name}>
                        <div className="fname">
                            {p.name}
                            <span className="tchip">{p.raw}</span>
                        </div>
                        <div className="ctl">
                            <TypeInput type={t} value={value[p.name]} onChange={v => set(p.name, v)} />
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
