import type { TlDef, TlType, TlParam } from './ir-types.js'
import { TlReader, BOOL_TRUE_ID, BOOL_FALSE_ID, VECTOR_ID } from './reader.js'
import { TlWriter } from './writer.js'
import { hexToBytes } from './bytes.js'

// Browser value representation: a TL object is a tagged `{ _: name, ...fields }`.
// Identical to @mt-tl/server's TlValue except binary is Uint8Array, not Buffer.
export type BValue = number | bigint | boolean | string | Uint8Array | BObject | BValue[] | null | undefined
export interface BObject {
    _: string
    [field: string]: BValue
}

/** Decode-by-id + encode-by-name index, built from parsed `TlDef`s. */
export class BrowserRegistry {
    private byId = new Map<number, TlDef>()
    private byName = new Map<string, TlDef>()

    register(def: TlDef): void {
        if (!this.byId.has(def.idNum)) this.byId.set(def.idNum, def)
        // Encode-by-name: first registration wins, EXCEPT a business (non-protocol) def
        // overrides a bundled protocol-core one. A consumer's own schema is authoritative
        // for any API method the protocol core also declares (e.g. invokeWithLayer /
        // initConnection), so if their layer's wire id differs from the core's, the
        // consumer's wins. Both ids stay in byId, so decode-by-id still covers either.
        const existing = this.byName.get(def.name)
        if (!existing || (existing.isProtocol && !def.isProtocol)) this.byName.set(def.name, def)
    }

    getById(idNum: number): TlDef | undefined {
        return this.byId.get(idNum >>> 0)
    }
    getByName(name: string): TlDef | undefined {
        return this.byName.get(name)
    }
    get size(): number {
        return this.byId.size
    }
}

/** Build a registry from already-parsed defs (protocol first → wins id/name clashes). */
export function buildRegistry(defs: TlDef[]): BrowserRegistry {
    const reg = new BrowserRegistry()
    for (const def of defs) reg.register(def)
    return reg
}

/**
 * Browser IR-driven (de)serializer — the generic path of @mt-tl/server's TlCodec
 * (no hand-written protocol codecs, no layered registry: a test client speaks
 * everything through the generic path). Decode is by wire id; encode is by name.
 */
export class TlCodec {
    constructor(private readonly registry: BrowserRegistry) {}

    encode(value: BObject): Uint8Array {
        const w = new TlWriter()
        this.writeObject(w, value)
        return w.toBytes()
    }

    decode(buf: Uint8Array): BValue {
        return this.readObject(new TlReader(buf))
    }

    // --- boxed object (with constructor id) ---------------------------------

    writeObject(w: TlWriter, value: BValue): void {
        if (typeof value === 'boolean') {
            w.writeBool(value)
            return
        }
        if (Array.isArray(value)) {
            w.writeUInt32(VECTOR_ID)
            w.writeUInt32(value.length)
            for (const el of value) this.writeObject(w, el)
            return
        }
        if (value && typeof value === 'object' && '_' in value) {
            const obj = value
            const def = this.registry.getByName(obj._)
            if (!def) throw new Error(`Cannot serialize unknown TL type: ${obj._}`)
            w.writeUInt32(def.idNum)
            this.writeFields(w, def.params, obj)
            return
        }
        throw new Error(`Cannot serialize value as boxed object: ${String(value)}`)
    }

    readObject(r: TlReader): BValue {
        const id = r.readUInt32()
        if (id === BOOL_TRUE_ID) return true
        if (id === BOOL_FALSE_ID) return false
        if (id === VECTOR_ID) {
            const count = r.readUInt32()
            const out: BValue[] = []
            for (let i = 0; i < count; i++) out.push(this.readObject(r))
            return out
        }
        const def = this.registry.getById(id)
        if (!def) {
            throw new Error(`Cannot read unknown TL id 0x${(id >>> 0).toString(16).padStart(8, '0')}`)
        }
        const obj: BObject = { _: def.name }
        this.readFields(r, def.params, obj)
        return obj
    }

    // --- bare constructor (no id) -------------------------------------------

    private writeBare(w: TlWriter, name: string, value: BValue): void {
        const def = this.registry.getByName(name)
        if (!def) throw new Error(`Cannot serialize unknown bare type: ${name}`)
        this.writeFields(w, def.params, (value ?? { _: name }) as BObject)
    }

    private readBare(r: TlReader, name: string): BObject {
        const def = this.registry.getByName(name)
        if (!def) throw new Error(`Cannot read unknown bare type: ${name}`)
        const obj: BObject = { _: name }
        this.readFields(r, def.params, obj)
        return obj
    }

    // --- fields (with flags handling) ---------------------------------------

    private writeFields(w: TlWriter, params: TlParam[], obj: BObject): void {
        const bitmaskFields = collectBitmaskFields(params)
        const flags: Record<string, number> = {}
        for (const p of params) {
            if (p.type.kind !== 'flag') continue
            const v = obj[p.name]
            const present = p.type.inner.kind === 'true' ? v === true : v !== undefined && v !== null
            if (present) flags[p.type.flagsField] = (flags[p.type.flagsField] ?? 0) | (1 << p.type.bit)
        }

        for (const p of params) {
            const t = p.type
            if (bitmaskFields.has(p.name)) {
                w.writeUInt32((flags[p.name] ?? 0) >>> 0)
            } else if (t.kind === 'flag') {
                const set = ((flags[t.flagsField] ?? 0) >>> t.bit) & 1
                if (set && t.inner.kind !== 'true') this.writeType(w, t.inner, obj[p.name])
            } else {
                this.writeType(w, t, obj[p.name])
            }
        }
    }

    private readFields(r: TlReader, params: TlParam[], obj: BObject): void {
        const bitmaskFields = collectBitmaskFields(params)
        const flags: Record<string, number> = {}
        for (const p of params) {
            const t = p.type
            if (bitmaskFields.has(p.name)) {
                const v = r.readUInt32()
                flags[p.name] = v
                obj[p.name] = v
            } else if (t.kind === 'flag') {
                const set = ((flags[t.flagsField] ?? 0) >>> t.bit) & 1
                if (set) obj[p.name] = t.inner.kind === 'true' ? true : this.readType(r, t.inner)
            } else {
                obj[p.name] = this.readType(r, t)
            }
        }
    }

    // --- single typed value --------------------------------------------------

    private writeType(w: TlWriter, t: TlType, value: BValue): void {
        switch (t.kind) {
            case 'int':
                w.writeInt32(Number(value ?? 0))
                return
            case 'long':
                w.writeLong(typeof value === 'bigint' ? value : BigInt((value as number | string) ?? 0))
                return
            case 'double':
                w.writeDouble(Number(value ?? 0))
                return
            case 'string':
                // The protocol schema declares pq/g_a/g_b/encrypted_data as `string`
                // but they carry raw bytes; `string` and `bytes` share a wire encoding.
                if (value instanceof Uint8Array) w.writeBytes(value)
                else w.writeString(value == null ? '' : String(value))
                return
            case 'bytes':
                w.writeBytes(asBytes(value))
                return
            case 'int128':
                w.writeFixed(asBytes(value), 16)
                return
            case 'int256':
                w.writeFixed(asBytes(value), 32)
                return
            case 'bool':
                w.writeBool(Boolean(value))
                return
            case 'true':
                return
            case 'flags':
                w.writeUInt32(Number(value ?? 0) >>> 0)
                return
            case 'vector':
                this.writeVector(w, t, Array.isArray(value) ? value : [])
                return
            case 'object':
            case 'boxed':
                this.writeObject(w, value)
                return
            case 'bare':
                this.writeBare(w, t.name, value)
                return
            case 'flag':
                throw new Error('flag must be handled by writeFields')
        }
    }

    private readType(r: TlReader, t: TlType): BValue {
        switch (t.kind) {
            case 'int':
                return r.readInt32()
            case 'long':
                return r.readLong()
            case 'double':
                return r.readDouble()
            case 'string':
                return r.readString()
            case 'bytes':
                return r.readBytes()
            case 'int128':
                return r.readInt128()
            case 'int256':
                return r.readInt256()
            case 'bool':
                return r.readUInt32() === BOOL_TRUE_ID
            case 'true':
                return true
            case 'flags':
                return r.readUInt32()
            case 'vector':
                return this.readVector(r, t)
            case 'object':
            case 'boxed':
                return this.readObject(r)
            case 'bare':
                return this.readBare(r, t.name)
            case 'flag':
                throw new Error('flag must be handled by readFields')
        }
    }

    private writeVector(w: TlWriter, t: Extract<TlType, { kind: 'vector' }>, arr: BValue[]): void {
        if (t.boxed) w.writeUInt32(VECTOR_ID)
        w.writeUInt32(arr.length)
        for (const el of arr) this.writeType(w, t.inner, el)
    }

    private readVector(r: TlReader, t: Extract<TlType, { kind: 'vector' }>): BValue[] {
        if (t.boxed) {
            const id = r.readUInt32()
            if (id !== VECTOR_ID) {
                throw new Error(`Expected Vector id, got 0x${(id >>> 0).toString(16).padStart(8, '0')}`)
            }
        }
        const count = r.readUInt32()
        const out: BValue[] = []
        for (let i = 0; i < count; i++) out.push(this.readType(r, t.inner))
        return out
    }
}

/**
 * Names of the bitmask fields in a param list: any `#` field plus any field
 * referenced by a conditional (`name.bit?...`).
 */
function collectBitmaskFields(params: TlParam[]): Set<string> {
    const names = new Set<string>()
    for (const p of params) {
        if (p.type.kind === 'flags') names.add(p.name)
        else if (p.type.kind === 'flag') names.add(p.type.flagsField)
    }
    return names
}

function asBytes(value: BValue): Uint8Array {
    if (value instanceof Uint8Array) return value
    if (value == null) return new Uint8Array(0)
    if (typeof value === 'string') return hexToBytes(value)
    throw new Error(`Expected bytes, got ${typeof value}`)
}
