import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { TlDef, TlParam } from './ir.js'
import { parseType } from './ir.js'
import { getTlObjectCrc32 } from './crc32.js'

const LINE_RE = /^([\w.]+)#([0-9a-fA-F]+)\s*(.*?)\s*=\s*([\w.]+)\s*;\s*$/

/**
 * Core MTProto constructors that scheme_0_protocol.tl leaves commented out
 * ("parsed manually"). They still need registry entries for id<->name lookup.
 */
const CORE_LINES: Array<{ kind: 'constructor' | 'method'; line: string }> = [
    { kind: 'constructor', line: 'vector#1cb5c415 = Vector;' },
    { kind: 'constructor', line: 'rpc_result#f35c6d01 req_msg_id:long result:Object = RpcResult;' },
    { kind: 'constructor', line: 'msg_container#73f1f8dc messages:vector<%Message> = MessageContainer;' },
    {
        kind: 'constructor',
        line: 'message#5bb8e511 msg_id:long seqno:int bytes:int body:Object = Message;',
    },
    { kind: 'constructor', line: 'msg_copy#e06046b2 orig_message:Message = MessageCopy;' },
    { kind: 'constructor', line: 'gzip_packed#3072cfa1 packed_data:bytes = Object;' },
]

function parseParams(paramsStr: string): TlParam[] {
    if (!paramsStr) return []
    return paramsStr
        .split(/\s+/)
        .filter(tok => tok.includes(':') && !tok.includes('{') && !tok.includes('}'))
        .map(tok => {
            const idx = tok.indexOf(':')
            const name = tok.slice(0, idx)
            const raw = tok.slice(idx + 1)
            return { name, raw, type: parseType(raw) }
        })
}

export interface ParsedLine {
    def: TlDef
    /** declared id differs from the crc32 of the normalized line */
    crcMismatch: boolean
}

function parseLine(
    line: string,
    kind: 'constructor' | 'method',
    isProtocol: boolean,
    validateCrc: boolean,
): ParsedLine | null {
    const m = line.match(LINE_RE)
    if (!m) return null
    const [, name, hashRaw, paramsStr, type] = m
    const id = hashRaw!.toLowerCase().padStart(8, '0')
    const def: TlDef = {
        id,
        idNum: parseInt(id, 16) >>> 0,
        name: name!,
        kind,
        params: parseParams(paramsStr ?? ''),
        type: type!,
        isProtocol,
    }
    const crcMismatch = validateCrc ? getTlObjectCrc32(line.trim()) !== id : false
    return { def, crcMismatch }
}

export interface ParseResult {
    defs: TlDef[]
    crcMismatches: Array<{ name: string; id: string; computed: string }>
}

export function parseTlText(text: string, isProtocol: boolean): ParseResult {
    const defs: TlDef[] = []
    const crcMismatches: ParseResult['crcMismatches'] = []
    let kind: 'constructor' | 'method' = 'constructor'

    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim()
        if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue
        if (line.includes('---types---')) {
            kind = 'constructor'
            continue
        }
        if (line.includes('---functions---')) {
            kind = 'method'
            continue
        }
        const parsed = parseLine(line, kind, isProtocol, true)
        if (!parsed) continue
        defs.push(parsed.def)
        if (parsed.crcMismatch) {
            crcMismatches.push({
                name: parsed.def.name,
                id: parsed.def.id,
                computed: getTlObjectCrc32(line),
            })
        }
    }

    return { defs, crcMismatches }
}

function parseCoreLines(): TlDef[] {
    return CORE_LINES.map(({ kind, line }) => {
        const parsed = parseLine(line, kind, true, false)
        if (!parsed) throw new Error(`Failed to parse core line: ${line}`)
        return parsed.def
    })
}

/**
 * Loads `*.tl` into the IR. Accepts a **directory** (every `*.tl` in it) or a
 * single **`.tl` file** — the latter is handy for a frozen per-layer snapshot
 * (`scheme_203.tl`) you want to parse in isolation, without a folder per layer.
 * `scheme_0_protocol.tl` is flagged as protocol; the manually-parsed MTProto core
 * constructors are merged in. Duplicate constructor ids are de-duplicated (first
 * wins).
 */
export function parseSchemaDir(dirOrFile: string): ParseResult {
    const isFile = statSync(dirOrFile).isFile()
    const dir = isFile ? dirname(dirOrFile) : dirOrFile
    const files = (isFile ? [basename(dirOrFile)] : readdirSync(dirOrFile))
        .filter(f => f.endsWith('.tl'))
        .sort()

    const seen = new Set<string>()
    const defs: TlDef[] = []
    const crcMismatches: ParseResult['crcMismatches'] = []

    for (const def of parseCoreLines()) {
        if (seen.has(def.id)) continue
        seen.add(def.id)
        defs.push(def)
    }

    for (const file of files) {
        const isProtocol = file === 'scheme_0_protocol.tl'
        const text = readFileSync(join(dir, file), 'utf-8')
        const res = parseTlText(text, isProtocol)
        crcMismatches.push(...res.crcMismatches)
        for (const def of res.defs) {
            if (seen.has(def.id)) continue
            seen.add(def.id)
            defs.push(def)
        }
    }

    return { defs, crcMismatches }
}
