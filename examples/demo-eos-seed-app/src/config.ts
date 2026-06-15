import { hostname } from 'node:os'
import type { MTProtoConfig } from '@mt-tl/server'
import { schemaDir, layersDir } from './schema.js'

// The framework (@mt-tl/server) is env-free: it takes an `MTProtoConfig` object.
// Reading the environment is the consumer's job — this is the app's composition
// root. It also points the gateway at THIS app's full `.tl` schema (the
// framework only ships the protocol layer).

const DISABLED = new Set(['off', 'none', 'disabled', 'no', 'false', '-', ''])

/** Parse a port env var. Returns undefined (disabled) for off/none/empty. */
function port(value: string | undefined, fallback: number): number | undefined {
    if (value === undefined) return fallback
    if (DISABLED.has(value.trim().toLowerCase())) return undefined
    const n = Number(value)
    return Number.isFinite(n) ? n : fallback
}

function int(name: string, fallback: number): number {
    const v = process.env[name]
    const n = v ? Number(v) : NaN
    return Number.isFinite(n) ? n : fallback
}

/** Builds the framework `MTProtoConfig` for this app from the environment. */
export function loadConfig(): MTProtoConfig {
    return {
        nodeId: process.env.NODE_ID || hostname(),
        wsPort: port(process.env.MTPROTO_WS_PORT ?? process.env.MTPROTO_PORT, 8081),
        tcpPort: port(process.env.MTPROTO_TCP_PORT, 8082),
        defaultLayer: int('DEFAULT_LAYER', 204),
        // This app owns its schema; hand the gateway the full set. SCHEMA_DIR /
        // SCHEMA_LAYERS_DIR still override for ad-hoc runs.
        schemaDir: process.env.SCHEMA_DIR || schemaDir,
        schemaLayersDir: process.env.SCHEMA_LAYERS_DIR || layersDir,
        rsaKeyPath: process.env.RSA_PRIVATE_KEY_PATH || undefined,
        disableMsgKeyCheck: process.env.DISABLE_MSG_KEY_CHECK === 'true',
        disableSeqNoCheck: process.env.DISABLE_SEQNO_CHECK === 'true',
        trustProxy: process.env.TRUST_PROXY === 'true',
        storage: {
            backend: process.env.STORAGE_BACKEND === 'mongo' ? 'mongo' : 'memory',
            mongoUrl: process.env.MONGO_URL,
            mongoDb: process.env.MONGO_DB,
        },
        updates: {
            enabled: process.env.UPDATES_ENABLED === 'true',
            redisUrl: process.env.REDIS_URL,
            presenceTtlMs: int('PRESENCE_TTL_MS', 60_000),
            managed: process.env.UPDATES_MANAGED === 'true',
        },
    }
}
