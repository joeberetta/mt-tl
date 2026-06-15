import type { TlDef, TlType } from '@mt-tl/tl'
import type { TlRegistry } from './registry.js'
import type { LayeredRegistry } from './layered-registry.js'
import { TlReader, BOOL_TRUE_ID, BOOL_FALSE_ID, VECTOR_ID } from './reader.js'
import { TlWriter } from './writer.js'
import type { TlObject, TlValue } from '@mt-tl/tl'

/**
 * IR-driven (de)serializer for arbitrary TL values. Constructed types are tagged
 * objects `{ _: name, ...fields }`. Hand-written protocol codecs (registered on
 * the registry) take precedence for their ids; everything else routes here.
 *
 * When a {@link LayeredRegistry} is supplied, `encode(value, layer)` writes each
 * type with the constructor id/fields valid at the client's layer (decoding
 * stays global by id). Without a layer, the merged registry is used.
 */
export class TlCodec {
    /** Set transiently during a single `encode(value, layer)` call. */
    private encodeLayer?: number

    constructor(
        private readonly registry: TlRegistry,
        private readonly layered?: LayeredRegistry,
    ) {}

    encode(value: TlObject, layer?: number): Buffer {
        this.encodeLayer = this.layered && layer !== undefined ? layer : undefined
        try {
            const w = new TlWriter()
            this.writeObject(w, value)
            return w.toBuffer()
        } finally {
            this.encodeLayer = undefined
        }
    }

    decode(buf: Buffer): TlValue {
        return this.readObject(new TlReader(buf))
    }

    /** Resolve the def to serialize a name with, honoring the active encode layer. */
    private defForWrite(name: string): TlDef | undefined {
        if (this.layered && this.encodeLayer !== undefined) {
            const layerDef = this.layered.resolve(name, this.encodeLayer)
            if (layerDef) return layerDef
        }
        return this.registry.getByName(name)
    }

    // --- boxed object (with constructor id) ---------------------------------

    writeObject(w: TlWriter, value: TlValue): void {
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
            const obj = value as TlObject
            const codec = this.protocolCodecByName(obj._)
            if (codec) {
                codec.write(w, obj)
                return
            }
            const def = this.defForWrite(obj._)
            if (!def) throw new Error(`Cannot serialize unknown TL type: ${obj._}`)
            w.writeUInt32(def.idNum)
            this.writeFields(w, def.params, obj)
            return
        }
        throw new Error(`Cannot serialize value as boxed object: ${String(value)}`)
    }

    readObject(r: TlReader): TlValue {
        const id = r.readUInt32()
        if (id === BOOL_TRUE_ID) return true
        if (id === BOOL_FALSE_ID) return false
        if (id === VECTOR_ID) {
            const count = r.readUInt32()
            const out: TlValue[] = []
            for (let i = 0; i < count; i++) out.push(this.readObject(r))
            return out
        }
        const protocolCodec = this.registry.getProtocolCodec(id)
        if (protocolCodec) return protocolCodec.read(r) as TlValue
        const def = this.registry.getById(id)
        if (!def) {
            throw new Error(`Cannot read unknown TL id 0x${(id >>> 0).toString(16).padStart(8, '0')}`)
        }
        const obj: TlObject = { _: def.name }
        this.readFields(r, def.params, obj)
        return obj
    }

    // --- bare constructor (no id) -------------------------------------------

    private writeBare(w: TlWriter, name: string, value: TlValue): void {
        const def = this.defForWrite(name)
        if (!def) throw new Error(`Cannot serialize unknown bare type: ${name}`)
        this.writeFields(w, def.params, (value ?? { _: name }) as TlObject)
    }

    private readBare(r: TlReader, name: string): TlObject {
        const def = this.registry.getByName(name)
        if (!def) throw new Error(`Cannot read unknown bare type: ${name}`)
        const obj: TlObject = { _: name }
        this.readFields(r, def.params, obj)
        return obj
    }

    // --- fields (with flags handling) ---------------------------------------

    private writeFields(w: TlWriter, params: import('@mt-tl/tl').TlParam[], obj: TlObject): void {
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
                // Bitmask field (`flags:#` or `flags:int`): write the value computed
                // from which conditional fields are present.
                w.writeUInt32((flags[p.name] ?? 0) >>> 0)
            } else if (t.kind === 'flag') {
                const set = ((flags[t.flagsField] ?? 0) >>> t.bit) & 1
                if (set && t.inner.kind !== 'true') this.writeType(w, t.inner, obj[p.name])
            } else {
                this.writeType(w, t, obj[p.name])
            }
        }
    }

    private readFields(r: TlReader, params: import('@mt-tl/tl').TlParam[], obj: TlObject): void {
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

    private writeType(w: TlWriter, t: TlType, value: TlValue): void {
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
                // Binary may be supplied for a `string` field (the protocol schema
                // declares pq/g_a/g_b/encrypted_data as `string`). Preserve bytes
                // exactly; `string` and `bytes` share the same wire encoding.
                if (Buffer.isBuffer(value)) w.writeBytes(value)
                else w.writeString(value == null ? '' : String(value))
                return
            case 'bytes':
                w.writeBytes(asBuffer(value))
                return
            case 'int128':
                w.writeFixed(asBuffer(value), 16)
                return
            case 'int256':
                w.writeFixed(asBuffer(value), 32)
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

    private readType(r: TlReader, t: TlType): TlValue {
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

    private writeVector(w: TlWriter, t: Extract<TlType, { kind: 'vector' }>, arr: TlValue[]): void {
        if (t.boxed) w.writeUInt32(VECTOR_ID)
        w.writeUInt32(arr.length)
        for (const el of arr) this.writeType(w, t.inner, el)
    }

    private readVector(r: TlReader, t: Extract<TlType, { kind: 'vector' }>): TlValue[] {
        if (t.boxed) {
            const id = r.readUInt32()
            if (id !== VECTOR_ID) {
                throw new Error(`Expected Vector id, got 0x${(id >>> 0).toString(16).padStart(8, '0')}`)
            }
        }
        const count = r.readUInt32()
        const out: TlValue[] = []
        for (let i = 0; i < count; i++) out.push(this.readType(r, t.inner))
        return out
    }

    private protocolCodecByName(name: string) {
        const def = this.registry.getByName(name)
        if (!def) return undefined
        return this.registry.getProtocolCodec(def.idNum)
    }
}

/**
 * Names of the bitmask fields in a param list: any `#` field plus any field
 * referenced by a conditional (`name.bit?...`). Handles schemas that declare
 * the bitmask as `flags:int` rather than the canonical `flags:#`.
 */
function collectBitmaskFields(params: import('@mt-tl/tl').TlParam[]): Set<string> {
    const names = new Set<string>()
    for (const p of params) {
        if (p.type.kind === 'flags') names.add(p.name)
        else if (p.type.kind === 'flag') names.add(p.type.flagsField)
    }
    return names
}

function asBuffer(value: TlValue): Buffer {
    if (Buffer.isBuffer(value)) return value
    if (value == null) return Buffer.alloc(0)
    if (typeof value === 'string') return Buffer.from(value, 'hex')
    throw new Error(`Expected Buffer, got ${typeof value}`)
}
