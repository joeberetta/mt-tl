import type { StorageBackend } from './storage/index.js'

/**
 * The configuration object you pass to {@link createServer}. The framework reads
 * **no** environment of its own — your app builds this (its composition root) and
 * hands it in. Only `nodeId`, `defaultLayer`, `schemaDir`, `schemaLayersDir`,
 * `storage`, and `updates` are required.
 *
 * @example
 * ```ts
 * const config: MTProtoConfig = {
 *   nodeId: 'node-1',
 *   wsPort: 8081,
 *   defaultLayer: 204,
 *   schemaDir,                 // your business .tl
 *   schemaLayersDir: layersDir,
 *   rsaKeyPath: process.env.RSA_PRIVATE_KEY_PATH,
 *   storage: { backend: 'mongo', mongoUrl: process.env.MONGO_URL },
 *   updates: { enabled: true, redisUrl: process.env.REDIS_URL, presenceTtlMs: 60_000 },
 * }
 * ```
 */
export interface MTProtoConfig {
    /** Stable id of this instance, unique per replica — the presence routing key. */
    nodeId: string
    /** WebSocket listen port. Omit to disable the WS carrier. */
    wsPort?: number
    /** Raw-TCP listen port. Omit to disable the TCP carrier. */
    tcpPort?: number
    /** TL layer assumed for a connection until it negotiates one via `invokeWithLayer`. */
    defaultLayer: number
    /**
     * Whitelist of accepted `initConnection.api_id`s. Omit (default) to accept any
     * id. When set, an `initConnection` carrying an id outside the list is rejected
     * with `rpc_error` `API_ID_INVALID` (400) and its wrapped query is not run —
     * so an unregistered app can't reach your handlers.
     */
    allowedApiIds?: number[]
    /** Directory of your business `.tl` schema (the protocol schema is bundled). */
    schemaDir: string
    /** Directory of per-layer snapshots (`scheme_N.json`) that drive layered encoding. */
    schemaLayersDir: string
    /**
     * Path to the server's RSA private key (PEM). Clients pin its fingerprint, so a
     * real client needs the production key here. Omitted → an ephemeral key is
     * generated (handshake works only for test clients).
     */
    rsaKeyPath?: string
    /**
     * Disable the inbound MTProto 2.0 `msg_key` integrity check. ⚠️ INSECURE — keep
     * `false` (the default). Only enable as a temporary interop shim for a
     * non-compliant client. See docs/internals/msgkey-v1-quirk.md.
     */
    disableMsgKeyCheck?: boolean
    /**
     * Disable inbound sequence-number validation (`bad_msg_notification` codes
     * 32/34/35). Default `false` = enforced: content-related messages (RPC queries)
     * must carry an odd, strictly increasing `seqno` and pure service messages an
     * even one. Set `true` as an interop shim for a client that does not set `seqno`
     * to spec — the same escape-hatch pattern as {@link disableMsgKeyCheck}.
     */
    disableSeqNoCheck?: boolean
    /**
     * Trust an upstream proxy/load balancer for the client address: parse the
     * PROXY-protocol header (v1/v2) on the raw-TCP carrier, and trust
     * `X-Forwarded-For` on WebSocket. Default `false` — leave off when clients
     * connect directly, since both are spoofable by a direct client. When `true`,
     * the announced IP surfaces as `ctx.request.ip`.
     */
    trustProxy?: boolean
    /** Where auth keys, server salts, and sessions persist. */
    storage: {
        /** `'memory'` (single process, dev) or `'mongo'` (shared, multi-replica). */
        backend: StorageBackend
        /** Mongo connection string (required when `backend: 'mongo'`). */
        mongoUrl?: string
        /** Mongo database name (defaults to the driver's database in the URL). */
        mongoDb?: string
    }
    /** Server-push (updates) delivery. */
    updates: {
        /** Master switch for server-push. When `false`, `ctx.push` is a no-op. */
        enabled: boolean
        /**
         * Redis URL for cross-instance presence + the pub/sub update bus. Omit for a
         * single process (in-memory presence/bus); required to deliver push across
         * replicas.
         */
        redisUrl?: string
        /** Presence entry TTL in ms; the node refreshes it on a heartbeat. */
        presenceTtlMs: number
        /**
         * Who owns the update state (`pts` + `updates.getState`/`getDifference`).
         * `false` (default) → your app owns it: handle those methods yourself and
         * embed `pts` in the updates you push. `true` → the engine owns it: it keeps
         * a durable per-user pts log (Mongo when `storage.backend: 'mongo'`, else
         * in-memory) and answers `updates.getState`/`updates.getDifference` itself.
         * Requires the `updates.*` types in your schema. Common-pts only — no qts,
         * seq, or per-channel pts.
         */
        managed?: boolean
    }
}
