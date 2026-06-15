import type { TlDef } from '@mt-tl/tl'
import { parseSchemaDir } from '@mt-tl/tl'

/**
 * Resolves TL definitions both ways: by wire constructor id (for decoding) and
 * by name (for encoding a result the backend returned as `{ _: name, ... }`).
 *
 * Hand-written protocol/service classes register a {@link ProtocolCodec} for
 * their id so the pipeline can read/write them with typed code; everything else
 * falls through to the generic, IR-driven codec.
 */
export interface ProtocolCodec {
    id: string
    name: string
    read(reader: import('./reader.js').TlReader): unknown
    write(writer: import('./writer.js').TlWriter, value: unknown): void
}

export class TlRegistry {
    private byId = new Map<number, TlDef>()
    private byName = new Map<string, TlDef>()
    private protocolCodecs = new Map<number, ProtocolCodec>()

    register(def: TlDef): void {
        if (!this.byId.has(def.idNum)) this.byId.set(def.idNum, def)
        if (!this.byName.has(def.name)) this.byName.set(def.name, def)
    }

    registerProtocolCodec(codec: ProtocolCodec): void {
        this.protocolCodecs.set(parseInt(codec.id, 16) >>> 0, codec)
    }

    getById(idNum: number): TlDef | undefined {
        return this.byId.get(idNum >>> 0)
    }

    getByName(name: string): TlDef | undefined {
        return this.byName.get(name)
    }

    getProtocolCodec(idNum: number): ProtocolCodec | undefined {
        return this.protocolCodecs.get(idNum >>> 0)
    }

    get size(): number {
        return this.byId.size
    }
}

export interface LoadSchemaResult {
    registry: TlRegistry
    constructors: number
    methods: number
    crcMismatches: number
}

/**
 * Loads + merges one or more `.tl` schema directories into a single registry.
 * The gateway merges the framework's protocol schema with the app's business
 * schema — pass protocol first (earlier dirs win a name/id clash).
 */
export function loadSchema(dirs: string | string[]): LoadSchemaResult {
    const list = Array.isArray(dirs) ? dirs : [dirs]
    const registry = new TlRegistry()
    let constructors = 0
    let methods = 0
    let crcMismatches = 0
    for (const dir of list) {
        const parsed = parseSchemaDir(dir)
        crcMismatches += parsed.crcMismatches.length
        for (const def of parsed.defs) {
            registry.register(def)
            if (def.kind === 'method') methods++
            else constructors++
        }
    }
    return { registry, constructors, methods, crcMismatches }
}
