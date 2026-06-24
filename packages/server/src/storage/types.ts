/** Persistence contracts for auth keys, server salts and sessions. */

/**
 * Connection/device metadata for an auth key. An auth key is one device
 * authorization (one app install), so this — captured from `initConnection` — is
 * stable per key and lives here rather than being duplicated across the key's
 * sessions. `apiLayer` is the last layer negotiated via `invokeWithLayer`,
 * restored for a fresh session before it re-negotiates.
 */
export interface AuthKeyMeta {
    apiLayer?: number
    /** `initConnection.api_id` — the client app id. */
    apiId?: number
    /** `initConnection.device_model`. */
    deviceModel?: string
    /** `initConnection.system_version`. */
    systemVersion?: string
    /** `initConnection.app_version`. */
    appVersion?: string
    /** `initConnection.system_lang_code`. */
    systemLangCode?: string
    /** `initConnection.lang_code`. */
    langCode?: string
    /**
     * The FULL decoded `initConnection` fields (minus `_`/`query`) as tagged JSON
     * (`bigint`→`{$bigint}`, `bytes`→`{$bin}`) — serialization-safe for any backend.
     * The standard fields above are also here; this is the escape hatch for CUSTOM
     * fields an overridden protocol schema adds (e.g. `tenant_id`).
     */
    initParams?: Record<string, unknown>
}

export interface AuthKeyRecord {
    id: bigint
    key: Buffer
    expiresIn: boolean
    createdAt: Date
    /** The bound subject (your internal user id), or null for an anonymous key. */
    subject: string | null
    isBlocked?: boolean
    meta?: AuthKeyMeta
}

export interface SessionRecord {
    sessionId: bigint
    authKeyId: bigint
    uniqueId: bigint
    apiLayer: number
    subject?: string
    lastActivity: number
}

export interface AuthKeyRepo {
    create(rec: AuthKeyRecord): Promise<void>
    getById(id: bigint): Promise<AuthKeyRecord | null>
    setBlocked(id: bigint, blocked: boolean): Promise<void>
    /** Bind (or clear, with null) the subject authorized on this auth key. */
    bindUser(id: bigint, subject: string | null): Promise<void>
    /** Merge `initConnection`-derived device/app fields into the key's meta. */
    updateMeta(id: bigint, patch: AuthKeyMeta): Promise<void>
}

/** One scheduled server salt and its validity window (unix seconds). */
export interface SaltScheduleEntry {
    salt: bigint
    /** Inclusive lower bound (unix seconds). */
    validSince: number
    /** Exclusive upper bound (unix seconds). */
    validUntil: number
}

export interface SaltRepo {
    /**
     * Persist salt-schedule entries for an auth key. Inserts only windows not
     * already present (keyed by `validSince`) and never overwrites an existing
     * window's salt, so concurrent gateway nodes converge on one salt per window.
     */
    append(authKeyId: bigint, entries: SaltScheduleEntry[]): Promise<void>
    /** Full salt schedule for an auth key, ascending by `validSince`. */
    list(authKeyId: bigint): Promise<SaltScheduleEntry[]>
    /** Drop entries that fully expired before `before` (unix seconds). */
    prune(authKeyId: bigint, before: number): Promise<void>
}

export interface SessionRepo {
    get(sessionId: bigint): Promise<SessionRecord | null>
    save(rec: SessionRecord): Promise<void>
    update(sessionId: bigint, patch: Partial<SessionRecord>): Promise<void>
    delete(sessionId: bigint): Promise<void>
    /** Refresh last-activity; returns true if the session existed. */
    touch(sessionId: bigint): Promise<boolean>
}

export interface Storage {
    authKeys: AuthKeyRepo
    salts: SaltRepo
    sessions: SessionRepo
    close(): Promise<void>
}
