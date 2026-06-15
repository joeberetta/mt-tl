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
    auth?: AuthSpec
}

/** One scenario step: an `invoke` (with `expect`/`expectError`/`capture`) or an `expectUpdate`. */
export interface Step {
    /** Which user runs this step; defaults to the lone/`default` user. */
    as?: string
    /** Human label for the report; derived if omitted. */
    label?: string
    /** Method to call. */
    invoke?: string
    /** Call params (interpolated). */
    params?: Record<string, unknown>
    /** Assert the rpc_result payload matches. */
    expect?: Matcher
    /** Assert the call fails with this rpc_error. */
    expectError?: { code?: number; message?: string }
    /** Wait for a pushed update matching this. */
    expectUpdate?: Matcher
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
        const kinds = [st.invoke !== undefined, st.expectUpdate !== undefined]
        if (kinds.filter(Boolean).length !== 1) {
            throw new Error(`${source}: step ${i} must have exactly one of 'invoke' | 'expectUpdate'`)
        }
    })
    return raw as Scenario
}
