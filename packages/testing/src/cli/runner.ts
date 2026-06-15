import type { TlObject } from '@mt-tl/tl'
import { RpcError, type TestSession } from '../session.js'
import { Scope, getByPath, type Generators } from './scope.js'
import { match, toUpdatePredicate, type Matcher } from './match.js'
import type { AuthSpec, Scenario, Step, TargetSpec } from './scenario.js'
import type { RecipeMap } from './recipes.js'

const DEFAULT_TIMEOUT_MS = 5000

export interface RunOptions {
    /** How to obtain a connected, handshaken session for a user. The CLI builds
     *  this from `target`; tests pass an in-process `server.connect`. */
    connect: (user: string) => Promise<TestSession>
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
            s = await opts.connect(user)
            sessions.set(user, s)
        }
        return s
    }

    const record = (r: StepReport): void => {
        reports.push(r)
        opts.log?.(`${r.ok ? '✓' : '✗'} [${r.user}] ${r.label}${r.error ? ` — ${r.error}` : ''}`)
    }

    try {
        // 1) Connect + authenticate declared users, in declaration order.
        for (const [user, spec] of Object.entries(scenario.users ?? {})) {
            const session = await getSession(user)
            if (spec.auth) await runAuth(user, spec.auth, session, scope, opts, scenario.target, record)
        }

        // 2) Run the scenario steps.
        const userNames = Object.keys(scenario.users ?? {})
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
            record(await runStep(i, user, step, session, scope, scenario.target))
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
                    scope,
                })
                record({ ...base, ok: true, durationMs: Date.now() - started })
            } catch (e) {
                record({ ...base, ok: false, durationMs: Date.now() - started, error: errMsg(e) })
            }
        }
    }
    for (const step of auth.steps ?? []) {
        record(await runStep(-1, user, step, session, scope, target))
    }
}

async function runStep(
    index: number,
    user: string,
    step: Step,
    session: TestSession,
    scope: Scope,
    target: TargetSpec,
): Promise<StepReport> {
    const started = Date.now()
    const label = step.label ?? labelOf(step)
    const timeoutMs = step.timeoutMs ?? target.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    const base = { index, user, label }
    try {
        if (step.invoke !== undefined) {
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
