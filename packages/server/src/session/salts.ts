import { randomBytes } from 'node:crypto'
import { toBigIntLE } from '../util/bytes.js'
import type { SaltRepo, SaltScheduleEntry } from '../storage/types.js'

/**
 * Server-salt scheduler — the spec-faithful core of the salt subsystem
 * (https://core.telegram.org/mtproto/service_messages).
 *
 * Each auth key gets a rolling schedule of 64-bit salts, each valid for a bounded
 * window (~30 min) with overlap: a new salt is minted before the previous expires,
 * so there is always a current salt and a ready successor.
 *
 * Windows lie on a deterministic grid anchored at the first (handshake-derived)
 * salt's `validSince`: window `k` is `[t0 + k·step, t0 + k·step + window)`. Because
 * the anchor is persisted and `step`/`window` are constants, every gateway node
 * derives the same window boundaries and (via the repo's insert-if-absent
 * semantics) converges on one salt per window — so any node validates any salt.
 */

const DEFAULT_WINDOW_SEC = 30 * 60
const DEFAULT_STEP_SEC = 15 * 60

export interface SaltServiceOptions {
    /** Validity length of each salt, seconds (default 1800 = 30 min). */
    windowSec?: number
    /** Spacing between consecutive window starts, seconds. Must be `<= windowSec`
     *  for overlap (default 900 = 15 min, giving two concurrently-valid salts). */
    stepSec?: number
    /** Windows to keep minted ahead of the current one (default 1). */
    prefetch?: number
    /** Injectable clock returning unix seconds (default `Date.now()/1000`). */
    nowSec?: () => number
}

/** Result of {@link SaltService.resolve}: the salt to advertise + whether the
 *  salt the client used is currently valid. */
export interface SaltCheck {
    current: bigint
    valid: boolean
}

export class SaltService {
    private readonly window: number
    private readonly step: number
    private readonly prefetch: number
    private readonly now: () => number

    constructor(
        private readonly repo: SaltRepo,
        opts: SaltServiceOptions = {},
    ) {
        this.window = opts.windowSec ?? DEFAULT_WINDOW_SEC
        this.step = opts.stepSec ?? DEFAULT_STEP_SEC
        this.prefetch = Math.max(0, opts.prefetch ?? 1)
        this.now = opts.nowSec ?? (() => Math.floor(Date.now() / 1000))
        if (this.step <= 0 || this.step > this.window) {
            throw new Error('SaltService: require 0 < stepSec <= windowSec for overlapping windows')
        }
    }

    /**
     * Seed the schedule's first window from the handshake-derived salt. Idempotent
     * (a no-op if a schedule already exists), and wire-compatible: the first salt
     * keeps its `xor(newNonce, serverNonce)` value.
     */
    async seed(authKeyId: bigint, firstSalt: bigint): Promise<void> {
        if ((await this.repo.list(authKeyId)).length) return
        const since = this.now()
        await this.repo.append(authKeyId, [
            { salt: firstSalt, validSince: since, validUntil: since + this.window },
        ])
    }

    /**
     * Advertise the current salt and report whether `clientSalt` is valid right
     * now. Mints the current window (and `prefetch` successors) on demand. The
     * decrypt path uses this to drive `bad_server_salt`.
     */
    async resolve(authKeyId: bigint, clientSalt: bigint): Promise<SaltCheck> {
        const now = this.now()
        const list = await this.ensure(authKeyId, now, this.prefetch)
        return {
            current: pickCurrent(list, now).salt,
            valid: list.some(e => covers(e, now) && e.salt === clientSalt),
        }
    }

    /**
     * The next `num` scheduled salts starting from the current window, minting
     * more if the schedule is short. Backs `get_future_salts(num)`.
     */
    async future(authKeyId: bigint, num: number): Promise<SaltScheduleEntry[]> {
        const n = Math.max(1, num)
        const now = this.now()
        const list = await this.ensure(authKeyId, now, n - 1)
        const { t0, kNow } = grid(list, now, this.step)
        const out: SaltScheduleEntry[] = []
        for (let k = kNow; k < kNow + n; k++) {
            const since = t0 + k * this.step
            const e = list.find(x => x.validSince === since)
            if (e) out.push(e)
        }
        return out
    }

    /**
     * Ensure the schedule contains the window covering `now` plus `ahead` further
     * grid windows; return the refreshed, ascending schedule. Opportunistically
     * prunes windows that expired more than one window ago.
     */
    private async ensure(authKeyId: bigint, now: number, ahead: number): Promise<SaltScheduleEntry[]> {
        let list = await this.repo.list(authKeyId)
        if (!list.length) {
            // Defensive: no handshake seed (e.g. get_future_salts on a key with no
            // persisted schedule). Anchor a fresh grid at now.
            await this.repo.append(authKeyId, [this.windowAt(now, randomSalt())])
            list = await this.repo.list(authKeyId)
        }

        const { t0, kNow } = grid(list, now, this.step)
        const missing: SaltScheduleEntry[] = []
        for (let k = kNow; k <= kNow + ahead; k++) {
            const since = t0 + k * this.step
            if (!list.some(e => e.validSince === since)) missing.push(this.windowAt(since, randomSalt()))
        }
        if (missing.length) {
            await this.repo.append(authKeyId, missing)
            list = await this.repo.list(authKeyId)
        }

        // Keep one window of expired history (covers messages still in flight).
        await this.repo.prune(authKeyId, now - this.window).catch(() => {})
        return list
    }

    private windowAt(since: number, salt: bigint): SaltScheduleEntry {
        return { salt, validSince: since, validUntil: since + this.window }
    }
}

function covers(e: SaltScheduleEntry, now: number): boolean {
    return e.validSince <= now && now < e.validUntil
}

/** The grid anchor `t0` (first window start) and the index `kNow` of the window
 *  covering `now`. All windows sit on `t0 + k·step`, so any surviving entry is a
 *  valid anchor — pruning the first one keeps the grid aligned. */
function grid(list: SaltScheduleEntry[], now: number, step: number): { t0: number; kNow: number } {
    const t0 = list[0]!.validSince
    return { t0, kNow: Math.max(0, Math.floor((now - t0) / step)) }
}

/** Newest window covering `now`; falls back to the latest entry if a gap. */
function pickCurrent(list: SaltScheduleEntry[], now: number): SaltScheduleEntry {
    let best: SaltScheduleEntry | undefined
    for (const e of list) if (covers(e, now) && (!best || e.validSince > best.validSince)) best = e
    return best ?? list[list.length - 1]!
}

function randomSalt(): bigint {
    return toBigIntLE(randomBytes(8))
}
