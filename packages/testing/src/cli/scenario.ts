import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import type { Matcher } from './match.js'

/** Where and how to reach the server under test. */
export interface TargetSpec {
    /** Connection URL: `ws://`/`wss://` (WebSocket) or `tcp://host:port` (raw TCP). */
    url?: string
    /** Force the transport; otherwise inferred from the URL scheme. */
    transport?: 'ws' | 'tcp'
    /** Business `.tl` schema dir(s), relative to the scenario file (protocol auto-merged). */
    schema?: string | string[]
    /** Path to the server's RSA public-key PEM, relative to the scenario file. */
    publicKey?: string
    /** Negotiate this TL layer on connect (via `invokeWithLayer`); otherwise the
     *  server's `defaultLayer` applies. */
    layer?: number
    /** Override `initConnection` fields (sent when `layer` is set). */
    initConnection?: Record<string, unknown>
    /** Default per-step timeout (ms). */
    defaultTimeoutMs?: number
}

/** How to authenticate a user before the scenario's steps run. */
export interface AuthSpec {
    /** Name of a recipe (app-supplied, loaded via `--recipes`) — for crypto logins. */
    recipe?: string
    /** Args passed to the recipe (interpolated against the scope). */
    with?: Record<string, unknown>
    /** OR an inline sequence of steps run at connect (for plain-RPC logins). */
    steps?: Step[]
}

export interface UserSpec {
    /** How to authenticate this user. OMIT for an ANONYMOUS session — it still
     *  connects + handshakes, just unauthenticated (e.g. to test pre-auth calls). */
    auth?: AuthSpec
    /** Negotiate this TL layer for THIS user (overrides `target.layer`) — so one
     *  scenario can connect users on different layers. */
    layer?: number
    /** Override `initConnection` fields for this user (api_id, device_model, …). */
    initConnection?: Record<string, unknown>
}

/** One scenario step: an `invoke`, an `expectUpdate`, or a `recipe` (a reusable
 *  named macro that runs several calls). */
export interface Step {
    /** Which user runs this step; defaults to the lone/`default` user. */
    as?: string
    /** Human label for the report; derived if omitted. */
    label?: string
    /** Method to call. */
    invoke?: string
    /** Call params (interpolated). */
    params?: Record<string, unknown>
    /** Run a named recipe (from the `--recipes` module) — a reusable multi-step
     *  macro on this user's session (e.g. `goOnline`, a login flow). */
    recipe?: string
    /** Args passed to the `recipe` (interpolated). */
    with?: Record<string, unknown>
    /** Assert the rpc_result payload matches. */
    expect?: Matcher
    /** Assert the call fails with this rpc_error. */
    expectError?: { code?: number; message?: string }
    /** Wait for a pushed update matching this. */
    expectUpdate?: Matcher
    /** For `expectUpdate`: DON'T block the scenario — register the expectation and
     *  proceed to the next step; it's checked (pass/fail) after all steps run. The
     *  set of non-blocking expectations is order-INDEPENDENT: each matches whenever
     *  its update arrives, and updates matching no expectation are ignored (never an
     *  error). Lets you arm an expectation before the step that triggers it. */
    nonBlocking?: boolean
    /** Capture values into the scope: `{ 'scope.path': 'result.path' }`. */
    capture?: Record<string, string>
    /** Override the step timeout (ms). */
    timeoutMs?: number
}

export interface Scenario {
    target: TargetSpec
    /** Free variables for `${...}` interpolation (overridable by config/`--var`). */
    vars?: Record<string, unknown>
    /** Named users (each authenticated before steps run). */
    users?: Record<string, UserSpec>
    steps: Step[]
}

/** Parse a YAML scenario file into a {@link Scenario} (with light validation). */
export function loadScenario(path: string): Scenario {
    const raw = parseYaml(readFileSync(path, 'utf8')) as unknown
    return validateScenario(raw, path)
}

/** Validate an already-parsed object as a {@link Scenario}. */
export function validateScenario(raw: unknown, source = '<scenario>'): Scenario {
    if (!raw || typeof raw !== 'object') throw new Error(`${source}: scenario must be a mapping`)
    const s = raw as Record<string, unknown>
    if (!s.target || typeof s.target !== 'object') throw new Error(`${source}: missing 'target'`)
    if (!Array.isArray(s.steps)) throw new Error(`${source}: 'steps' must be a list`)
    s.steps.forEach((step, i) => {
        if (!step || typeof step !== 'object') throw new Error(`${source}: step ${i} must be a mapping`)
        const st = step as Step
        const kinds = [st.invoke !== undefined, st.expectUpdate !== undefined, st.recipe !== undefined]
        if (kinds.filter(Boolean).length !== 1) {
            throw new Error(`${source}: step ${i} must have exactly one of 'invoke' | 'expectUpdate' | 'recipe'`)
        }
    })
    return raw as Scenario
}
