import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { parseSchemaDir, protocolSchemaDir, type TlDef } from '@mt-tl/tl'
import { loadSchema, TlCodec as NodeCodec } from '@mt-tl/server/testkit'
import { buildRegistry, TlCodec as BrowserCodec, type BObject } from '../src/client/codec.js'

// The ported browser codec must be byte-identical to @mt-tl/server's node codec,
// or a value encoded in the playground won't be understood by the server (and
// vice-versa). Strategy per value: assert encode bytes match exactly, and that
// both codecs decode the same bytes into the same shape.

const demoSchemaDir = fileURLToPath(new URL('../../../examples/demo-eos-seed-app/schema', import.meta.url))

const protocolDefs: TlDef[] = parseSchemaDir(protocolSchemaDir).defs
const bizDefs: TlDef[] = parseSchemaDir(demoSchemaDir).defs

const nodeCodec = new NodeCodec(loadSchema([protocolSchemaDir, demoSchemaDir]).registry)
const browserCodec = new BrowserCodec(buildRegistry([...protocolDefs, ...bizDefs]))

const buf = (hex: string): Buffer => Buffer.from(hex, 'hex')
const bytesEqual = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b))

// Buffers/Uint8Array → hex, bigint → tagged string, recursively — so a node-decoded
// value (Buffers/bigints) and a browser-decoded one (Uint8Array/bigints) compare equal.
function normalize(v: unknown): unknown {
    if (v instanceof Uint8Array) return 'b:' + Buffer.from(v).toString('hex')
    if (typeof v === 'bigint') return 'n:' + v.toString()
    if (Array.isArray(v)) return v.map(normalize)
    if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, val] of Object.entries(v)) out[k] = normalize(val)
        return out
    }
    return v
}

// Recursively swap Buffer → Uint8Array so the same value drives the browser codec.
function toBrowser(v: unknown): unknown {
    if (Buffer.isBuffer(v)) return new Uint8Array(v)
    if (Array.isArray(v)) return v.map(toBrowser)
    if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, val] of Object.entries(v)) out[k] = toBrowser(val)
        return out
    }
    return v
}

// Values chosen to exercise every codec path: int128/int256/long/string-as-bytes
// (handshake types), flags + optional + true-flag, boxed/bare vectors, nested
// boxed objects (empty + with fields), and a double.
const SAMPLES: Record<string, Record<string, unknown>> = {
    p_q_inner_data: {
        _: 'p_q_inner_data',
        pq: buf('17ed48941a08f981'),
        p: buf('494c553b'),
        q: buf('53911073'),
        nonce: buf('000102030405060708090a0b0c0d0e0f'),
        server_nonce: buf('101112131415161718191a1b1c1d1e1f'),
        new_nonce: buf('202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f'),
    },
    client_DH_inner_data: {
        _: 'client_DH_inner_data',
        nonce: buf('000102030405060708090a0b0c0d0e0f'),
        server_nonce: buf('101112131415161718191a1b1c1d1e1f'),
        retry_id: 0n,
        g_b: buf('deadbeefcafe'),
    },
    'account.checkFields': {
        _: 'account.checkFields',
        flags: 0, // recomputed by the codec from which optionals are present
        phone_number: '+1555',
        username: 'neo',
        // email / first_name / last_name omitted
    },
    'account.registerDevice': {
        _: 'account.registerDevice',
        token_type: 7,
        token: 'abc-token',
        app_sandbox: true,
        secret: buf('0badf00d'),
        other_uids: [10, 20, 30],
    },
    'crypto.transaction': {
        _: 'crypto.transaction',
        flags: 0,
        tx_id: 'tx_123',
        symbol: 'USDT',
        date: 1700000000,
        actions: [
            { _: 'crypto.transactionAction', from_id: 1, to_id: 2, amount: '5.0', memo: 'gm' },
            { _: 'crypto.transactionAction', from_id: 3, to_id: 4, amount: '1.5', memo: '' },
        ],
        type: { _: 'crypto.transactionTypeDefault' }, // nested boxed, no fields
        read: true, // flags.2?true present
        // note (flags.0) / explorer_url (flags.1) omitted
    },
    jsonNumber: { _: 'jsonNumber', value: 3.141592653589793 },
}

describe('browser codec ≡ node codec', () => {
    for (const [name, value] of Object.entries(SAMPLES)) {
        it(`${name}: encode bytes match + both decode identically`, () => {
            const nb = nodeCodec.encode(value as never)
            const bb = browserCodec.encode(toBrowser(value) as BObject)
            expect(bytesEqual(bb, nb)).toBe(true)

            const nd = nodeCodec.decode(nb)
            const bd = browserCodec.decode(new Uint8Array(nb))
            expect(normalize(bd)).toEqual(normalize(nd))
        })
    }
})
