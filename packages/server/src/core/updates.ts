import type { JsonValue } from '@mt-tl/tl'

/**
 * Durable per-subject update log: assigns the next `pts` and persists the update.
 * `updates.getDifference` reads from here. The gateway never sees pts — it only
 * delivers live updates best-effort; correctness is this log + getDifference.
 * Keyed by `subject` (your internal user id), like the rest of the push path.
 */
export interface UpdateLog {
    append(subject: string, update: JsonValue): Promise<{ pts: number }>
    /** Updates with pts in (sincePts, +inf], for getDifference. */
    since(subject: string, sincePts: number): Promise<Array<{ pts: number; update: JsonValue }>>
    currentPts(subject: string): Promise<number>
}

/** Publishes a routed live update onto the update bus (in-memory, or Redis pub/sub in prod). */
export type UpdatePublish = (msg: {
    subject?: string
    authKeyId?: string
    update: JsonValue
    pts?: number
}) => Promise<void>

/**
 * Emits a server update. `emit(subject, …)` is the common path: append to the
 * durable log (assigns pts) then publish — this backs `ctx.push`. `emitToAuthKey`
 * targets a specific (possibly anonymous) connection by auth key, with no pts
 * (anonymous connections have no durable update state).
 */
export interface UpdateEmitter {
    emit(subject: string, update: JsonValue): Promise<void>
    emitToAuthKey(authKeyId: string, update: JsonValue): Promise<void>
}

/** The default {@link UpdateEmitter}: log (for pts) then publish to the bus. */
export class LoggingUpdateEmitter implements UpdateEmitter {
    constructor(
        private readonly log: UpdateLog,
        private readonly publish: UpdatePublish,
    ) {}

    async emit(subject: string, update: JsonValue): Promise<void> {
        const { pts } = await this.log.append(subject, update)
        await this.publish({ subject, update, pts })
    }

    async emitToAuthKey(authKeyId: string, update: JsonValue): Promise<void> {
        await this.publish({ authKeyId, update })
    }
}

/** In-memory update log (single process / tests). Use a Mongo impl in prod. */
export class InMemoryUpdateLog implements UpdateLog {
    private bySubject = new Map<string, Array<{ pts: number; update: JsonValue }>>()

    async append(subject: string, update: JsonValue): Promise<{ pts: number }> {
        const list = this.bySubject.get(subject) ?? []
        const pts = (list.at(-1)?.pts ?? 0) + 1
        list.push({ pts, update })
        this.bySubject.set(subject, list)
        return { pts }
    }
    async since(subject: string, sincePts: number): Promise<Array<{ pts: number; update: JsonValue }>> {
        return (this.bySubject.get(subject) ?? []).filter(e => e.pts > sincePts)
    }
    async currentPts(subject: string): Promise<number> {
        return this.bySubject.get(subject)?.at(-1)?.pts ?? 0
    }
}
