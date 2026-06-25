import type { TlObject } from '@mt-tl/tl'
import { RpcError, type TestSession, type ConnectOpts } from '../session.js'
import { Scope, getByPath, userScope, type Generators } from './scope.js'
import { match, toUpdatePredicate, type Matcher } from './match.js'
import { formatStep } from './report.js'
import type { AuthSpec, Scenario, Step, TargetSpec } from './scenario.js'
import type { RecipeMap } from './recipes.js'

const DEFAULT_TIMEOUT_MS = 5000

export interface RunOptions {
    /** How to obtain a connected, handshaken session for a user. `opts` carries
     *  the user's per-user `layer`/`initConnection`. The CLI builds this from
     *  `target`; tests pass an in-process `server.connect`. */
    connect: (user: string, opts?: ConnectOpts) => Promise<TestSession>
    /** Auth recipes, by name (for `user.auth.recipe`). */
    recipes?: RecipeMap
    /** Custom `${...}` generators (e.g. `{ mnemonic: () => … }`). */
    generators?: Generators
    /** Environment for `${env.*}` interpolation. Defaults to none. */
    env?: Record<string, string | undefined>
    /** Progress sink (one line per step). */
    log?: (line: string) => void
}

export interface StepReport {
    index: number
    user: string
    label: string
    ok: boolean
    durationMs: number
    error?: string
}

export interface RunReport {
    ok: boolean
    users: string[]
    steps: StepReport[]
    durationMs: number
}

/**
 * Execute a scenario: connect + authenticate each declared user, then run every
 * step against its `as` user, collecting a pass/fail {@link StepReport} per step.
 * Pure orchestration over `opts.connect` — transport/codec/key plumbing lives in
 * the CLI (`run.ts`), so this runs identically against a remote stand or an
 * in-process test server.
 */
export async function runScenario(scenario: Scenario, opts: RunOptions): Promise<RunReport> {
    const scope = new Scope({ ...(scenario.vars ?? {}), env: { ...(opts.env ?? {}) } }, opts.generators)
    const sessions = new Map<string, TestSession>()
    const reports: StepReport[] = []
    const startedAt = Date.now()

    const getSession = async (user: string): Promise<TestSession> => {
        let s = sessions.get(user)
        if (!s) {
            const spec = scenario.users?.[user]
            s = await opts.connect(user, { layer: spec?.layer, initConnection: spec?.initConnection })
            sessions.set(user, s)
        }
        return s
    }

    const record = (r: StepReport): void => {
        reports.push(r)
        opts.log?.(formatStep(r))
    }

    try {
        // 1) Connect + authenticate declared users, in declaration order.
        for (const [user, spec] of Object.entries(scenario.users ?? {})) {
            const session = await getSession(user)
            if (spec.auth) await runAuth(user, spec.auth, session, scope, opts, scenario.target, record)
        }

        // 2) Run the scenario steps. A `nonBlocking` expectUpdate registers its
        //    expectation and proceeds; all deferred expectations are settled after
        //    the loop (order-independent — see step 3).
        const userNames = Object.keys(scenario.users ?? {})
        const deferred: Array<{ base: { index: number; user: string; label: string }; promise: Promise<unknown>; capture?: Record<string, string>; started: number }> = []
        for (let i = 0; i < scenario.steps.length; i++) {
            const step = scenario.steps[i]!
            const user = step.as ?? (userNames.length <= 1 ? (userNames[0] ?? 'default') : undefined)
            if (!user) {
                record({
                    index: i,
                    user: '?',
                    label: labelOf(step),
                    ok: false,
                    durationMs: 0,
                    error: "missing 'as' (scenario has multiple users)",
                })
                continue
            }
            const session = await getSession(user)
            if (step.expectUpdate !== undefined && step.nonBlocking) {
                const timeoutMs = step.timeoutMs ?? scenario.target.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
                const promise = session.expectUpdate(toUpdatePredicate(step.expectUpdate, scope), { timeoutMs })
                // swallow late rejection so an unsettled promise can't crash the process
                promise.catch(() => {})
                deferred.push({
                    base: { index: i, user, label: `${step.label ?? labelOf(step)} [non-blocking]` },
                    promise,
                    capture: step.capture,
                    started: Date.now(),
                })
                continue
            }
            record(await runStep(i, user, step, session, scope, scenario.target, opts.recipes))
        }

        // 3) Settle deferred non-blocking expectations: each passes if its update
        //    arrived (in any order) within its timeout, fails otherwise. Updates that
        //    matched no expectation were simply ignored.
        for (const d of deferred) {
            try {
                const update = (await d.promise) as TlObject
                applyCaptures(d.capture, update, scope)
                record({ ...d.base, ok: true, durationMs: Date.now() - d.started })
            } catch (e) {
                record({ ...d.base, ok: false, durationMs: Date.now() - d.started, error: errMsg(e) })
            }
        }
    } finally {
        for (const s of sessions.values()) s.close()
    }

    return {
        ok: reports.every(r => r.ok),
        users: [...sessions.keys()],
        steps: reports,
        durationMs: Date.now() - startedAt,
    }
}

async function runAuth(
    user: string,
    auth: AuthSpec,
    session: TestSession,
    scope: Scope,
    opts: RunOptions,
    target: TargetSpec,
    record: (r: StepReport) => void,
): Promise<void> {
    if (auth.recipe) {
        const started = Date.now()
        const recipe = opts.recipes?.[auth.recipe]
        const base = { index: -1, user, label: `auth recipe ${auth.recipe}` }
        if (!recipe) {
            record({
                ...base,
                ok: false,
                durationMs: 0,
                error: `recipe '${auth.recipe}' not found (pass --recipes)`,
            })
        } else {
            try {
                await recipe({
                    session,
                    user,
                    args: scope.interpolate(auth.with ?? {}) as Record<string, unknown>,
                    scope: userScope(scope, user),
                })
                record({ ...base, ok: true, durationMs: Date.now() - started })
            } catch (e) {
                record({ ...base, ok: false, durationMs: Date.now() - started, error: errMsg(e) })
            }
        }
    }
    for (const step of auth.steps ?? []) {
        record(await runStep(-1, user, step, session, scope, target, opts.recipes))
    }
}

async function runStep(
    index: number,
    user: string,
    step: Step,
    session: TestSession,
    scope: Scope,
    target: TargetSpec,
    recipes?: RecipeMap,
): Promise<StepReport> {
    const started = Date.now()
    const label = step.label ?? labelOf(step)
    const timeoutMs = step.timeoutMs ?? target.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    const base = { index, user, label }
    try {
        if (step.recipe !== undefined) {
            const recipe = recipes?.[step.recipe]
            if (!recipe) throw new Error(`recipe '${step.recipe}' not found (pass --recipes)`)
            await recipe({ session, user, args: scope.interpolate(step.with ?? {}) as Record<string, unknown>, scope: userScope(scope, user) })
        } else if (step.invoke !== undefined) {
            const params = scope.interpolate(step.params ?? {}) as Record<string, unknown>
            if (step.expectError) {
                await assertRpcError(
                    () => session.invoke(step.invoke!, params, { timeoutMs }),
                    step.expectError,
                )
            } else {
                const result = (await session.invoke(step.invoke, params, { timeoutMs })) as TlObject
                assertMatch(step.expect, result, scope)
                applyCaptures(step.capture, result, scope)
            }
        } else if (step.expectUpdate !== undefined) {
            const update = await session.expectUpdate(toUpdatePredicate(step.expectUpdate, scope), {
                timeoutMs,
            })
            applyCaptures(step.capture, update, scope)
        }
        return { ...base, ok: true, durationMs: Date.now() - started }
    } catch (e) {
        return { ...base, ok: false, durationMs: Date.now() - started, error: errMsg(e) }
    }
}

async function assertRpcError(
    call: () => Promise<unknown>,
    want: { code?: number; message?: string },
): Promise<void> {
    try {
        await call()
    } catch (e) {
        if (!(e instanceof RpcError)) throw e
        if (want.code !== undefined && e.code !== want.code) {
            throw new Error(`expected rpc_error code ${want.code}, got ${e.code}`)
        }
        if (want.message !== undefined && e.message !== want.message) {
            throw new Error(`expected rpc_error "${want.message}", got "${e.message}"`)
        }
        return
    }
    throw new Error('expected an rpc_error, but the call succeeded')
}

function assertMatch(matcher: Matcher | undefined, actual: TlObject, scope: Scope): void {
    if (matcher === undefined) return
    const r = match(matcher, actual, scope)
    if (!r.ok) {
        const detail = r.mismatches
            .map(m => `${m.path}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`)
            .join('; ')
        throw new Error(`expect failed (${detail})`)
    }
}

function applyCaptures(capture: Record<string, string> | undefined, source: TlObject, scope: Scope): void {
    if (!capture) return
    for (const [scopePath, sourcePath] of Object.entries(capture)) {
        scope.set(scopePath, getByPath(source, sourcePath))
    }
}

function labelOf(step: Step): string {
    if (step.recipe !== undefined) return `recipe ${step.recipe}`
    if (step.invoke !== undefined) return `invoke ${step.invoke}`
    if (typeof step.expectUpdate === 'string') return `expectUpdate ${step.expectUpdate}`
    if (step.expectUpdate && typeof step.expectUpdate === 'object') {
        return `expectUpdate ${String(step.expectUpdate._ ?? 'update')}`
    }
    return 'step'
}

function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
}
