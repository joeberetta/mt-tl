// The studio ⇄ @mt-tl/testing scenario serializer. Pure (no React) so it can be
// unit-tested and so a studio-built YAML round-trips through testing's
// `validateScenario`. Mirrors packages/testing/src/cli/scenario.ts (Step/Scenario/
// UserSpec/AuthSpec/TargetSpec) + match.ts (Matcher). Keep the two in sync.
//
// What the builder models vs. what testing accepts:
//   - steps: invoke | expectUpdate | recipe (exactly one — testing's rule)
//   - invoke: params, expect (a Matcher: `_` ctor + extra `path: value` fields) OR
//     expectError ({ code?, message? }), capture, timeoutMs
//   - expectUpdate: a Matcher (`_` ctor + extra `path: value` fields), timeoutMs
//   - recipe: a named macro + `with` args
//   - users: per-user layer + auth ({ recipe, with } | { steps: [...] } | anonymous)
//   - top-level vars + target (url + schema/publicKey placeholders for CLI runs)

import { parse as parseYaml } from 'yaml'
import { yamlValue } from './value-format.js'
import type { BObject, BValue } from './client/codec.js'

export type Kind = 'invoke' | 'expectUpdate' | 'recipe'
export type ExpectMode = 'result' | 'error'
export type AuthMode = 'anonymous' | 'recipe' | 'steps'
export type Nid = () => number

export interface User {
    id: number
    name: string
    layer: string
    authMode: AuthMode
    recipe: string
    with: string
    /** Inline plain-RPC login steps (when authMode === 'steps'). */
    authSteps: Step[]
}

export interface Step {
    id: number
    as: string
    label: string
    kind: Kind
    // invoke
    method: string
    value: BObject
    expectMode: ExpectMode
    /** result/update `_` constructor, or (expectMode='error') the rpc_error code. */
    expect: string
    /** expectError message to match (optional). */
    errorMessage: string
    /** Extra match fields for expect/expectUpdate: `path = value, path2 = value2`. */
    matchSpec: string
    /** expectUpdate (and any step): wait/timeout in seconds. */
    timeoutSec: string
    /** invoke captures: `scopeKey = result.path, …` → referenceable later as `${scopeKey}`. */
    capture: string
    // recipe
    recipe: string
    /** recipe args (JSON), passed as ctx.args. */
    with: string
}

// Placeholder paths the CLI runner needs (filled in by the user after export).
const SCHEMA_PLACEHOLDER = './schema'
const PUBKEY_PLACEHOLDER = './server.pub'

export const emptyStep = (as: string, nid: Nid): Step => ({
    id: nid(),
    as,
    label: '',
    kind: 'invoke',
    method: '',
    value: { _: '' },
    expectMode: 'result',
    expect: '',
    errorMessage: '',
    matchSpec: '',
    timeoutSec: '',
    capture: '',
    recipe: '',
    with: '',
})

export const emptyUser = (name: string, nid: Nid): User => ({
    id: nid(),
    name,
    layer: '',
    authMode: 'anonymous',
    recipe: '',
    with: '',
    authSteps: [],
})

/** Parse a `key = a.b, key2 = c` spec into [left, right] pairs (capture + match fields). */
export function parsePairs(spec: string): Array<[string, string]> {
    return spec
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
            const i = s.indexOf('=')
            return i < 0
                ? ([s.trim(), s.trim()] as [string, string])
                : ([s.slice(0, i).trim(), s.slice(i + 1).trim()] as [string, string])
        })
        .filter(([k, p]) => k && p)
}

const compactJson = (raw: string): string => {
    try {
        return JSON.stringify(JSON.parse(raw))
    } catch {
        return raw.trim()
    }
}

// Mask a `with`/auth secret JSON for the EXPORT/SHARE artifact: keep the keys,
// replace each value with a `your <key>` placeholder — so a shared scenario carries
// no secrets and re-imports paste-ready (just fill the placeholders).
const maskWith = (raw: string): string => {
    try {
        const o = JSON.parse(raw) as Record<string, unknown>
        return JSON.stringify(Object.fromEntries(Object.keys(o).map(k => [k, `your ${k}`])))
    } catch {
        return raw.trim()
    }
}

/** Emit a user-typed string as a YAML-safe flow scalar (bare when simple, quoted otherwise). */
const scalar = (s: string): string => (/^[\w.+-]+$/.test(s) ? s : JSON.stringify(s))

const stripTag = (value: BObject): string[] => Object.keys(value).filter(k => k !== '_')

const paramsInline = (value: BObject): string => {
    const keys = stripTag(value)
    return keys.length ? `{ ${keys.map(k => `${k}: ${yamlValue(value[k] as BValue)}`).join(', ')} }` : ''
}

/** Build the body fields of a Matcher `{ _: ctor, path: value, … }` (without braces). */
function matchBody(ctor: string, matchSpec: string): string[] {
    const fields: string[] = []
    if (ctor) fields.push(`_: ${ctor}`)
    for (const [path, val] of parsePairs(matchSpec)) fields.push(`${path}: ${scalar(val)}`)
    return fields
}

/** Serialize one step to its inline flow form `{ … }` (without the leading `- `).
 *  `includeAs` is false for inline auth.steps (the user is implicit). */
function stepFlow(st: Step, includeAs: boolean): string {
    const parts: string[] = []
    if (includeAs) parts.push(`as: ${st.as}`)
    if (st.label) parts.push(`label: ${JSON.stringify(st.label)}`)
    if (st.kind === 'recipe') {
        parts.push(`recipe: ${st.recipe || 'TODO'}`)
        if (st.with?.trim()) parts.push(`with: ${compactJson(st.with)}`)
    } else if (st.kind === 'invoke') {
        parts.push(`invoke: ${st.method || 'TODO'}`)
        const p = paramsInline(st.value)
        if (p) parts.push(`params: ${p}`)
        if (st.expectMode === 'error') {
            const e: string[] = []
            if (st.expect) e.push(`code: ${st.expect}`)
            if (st.errorMessage) e.push(`message: ${scalar(st.errorMessage)}`)
            parts.push(`expectError: {${e.length ? ` ${e.join(', ')} ` : ''}}`)
        } else {
            const body = matchBody(st.expect, st.matchSpec)
            if (body.length) parts.push(`expect: { ${body.join(', ')} }`)
        }
        const caps = parsePairs(st.capture)
        if (caps.length) parts.push(`capture: { ${caps.map(([k, p]) => `${k}: ${p}`).join(', ')} }`)
        if (st.timeoutSec) parts.push(`timeoutMs: ${Number(st.timeoutSec) * 1000}`)
    } else {
        const body = matchBody(st.expect || 'TODO', st.matchSpec)
        parts.push(`expectUpdate: { ${body.join(', ')} }`)
        if (st.timeoutSec) parts.push(`timeoutMs: ${Number(st.timeoutSec) * 1000}`)
    }
    return `{ ${parts.join(', ')} }`
}

function userFlow(u: User, mask: boolean): string {
    const fields: string[] = []
    if (u.layer) fields.push(`layer: ${u.layer}`)
    if (u.authMode === 'recipe' && u.recipe) {
        const withInline = u.with?.trim() ? `, with: ${(mask ? maskWith : compactJson)(u.with)}` : ''
        fields.push(`auth: { recipe: ${u.recipe}${withInline} }`)
    } else if (u.authMode === 'steps' && u.authSteps.length) {
        fields.push(`auth: { steps: [${u.authSteps.map(s => stepFlow(s, false)).join(', ')}] }`)
    }
    return `{${fields.length ? ` ${fields.join(', ')} ` : ''}}`
}

export interface ScenarioState {
    url: string
    /** Top-level `${...}` vars as a JSON object string (e.g. `{"tag":"hi"}`). */
    vars: string
    users: User[]
    steps: Step[]
}

/**
 * Serialize builder state to mt-tl-test scenario YAML. `mask` replaces auth `with`
 * secrets with `your <key>` placeholders (for the export/share artifact). The
 * target always carries `schema`/`publicKey` PLACEHOLDERS so the export is
 * CLI-runnable once the user points them at their real files.
 */
export function toYaml(state: ScenarioState, mask = false): string {
    const { url, vars, users, steps } = state
    const out: string[] = ['target:', `    url: ${url}`, `    schema: ${SCHEMA_PLACEHOLDER}`, `    publicKey: ${PUBKEY_PLACEHOLDER}`]
    if (vars?.trim() && vars.trim() !== '{}') out.push(`vars: ${compactJson(vars)}`)
    const multi = users.length > 1 || users.some(u => u.layer || u.authMode !== 'anonymous')
    if (multi) {
        out.push('users:')
        for (const u of users) out.push(`    ${u.name}: ${userFlow(u, mask)}`)
    }
    out.push('steps:')
    for (const st of steps) out.push(`    - ${stepFlow(st, multi)}`)
    return out.join('\n') + '\n'
}

/** Stringify a match value back into the `path = value` UI form. */
const matchValStr = (v: unknown): string =>
    typeof v === 'string' ? v : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)

function parseStep(raw: any, fallbackUser: string, nid: Nid): Step {
    const st = emptyStep(raw?.as ?? fallbackUser, nid)
    st.as = raw?.as ?? fallbackUser
    st.label = raw?.label ?? ''
    if (raw?.timeoutMs) st.timeoutSec = String(raw.timeoutMs / 1000)
    if (raw?.recipe !== undefined) {
        st.kind = 'recipe'
        st.recipe = raw.recipe ?? ''
        st.with = raw.with ? JSON.stringify(raw.with) : ''
    } else if (raw?.expectUpdate !== undefined) {
        st.kind = 'expectUpdate'
        const m = raw.expectUpdate
        if (typeof m === 'string') {
            st.expect = m
        } else {
            st.expect = m?._ ?? ''
            st.matchSpec = Object.keys(m ?? {})
                .filter(k => k !== '_')
                .map(k => `${k} = ${matchValStr(m[k])}`)
                .join(', ')
        }
    } else {
        st.kind = 'invoke'
        st.method = raw?.invoke ?? ''
        st.value = { _: st.method, ...(raw?.params ?? {}) }
        if (raw?.expectError) {
            st.expectMode = 'error'
            st.expect = raw.expectError.code != null ? String(raw.expectError.code) : ''
            st.errorMessage = raw.expectError.message != null ? String(raw.expectError.message) : ''
        } else {
            st.expectMode = 'result'
            const e = raw?.expect
            if (typeof e === 'string') {
                st.expect = e
            } else if (e && typeof e === 'object') {
                st.expect = e._ ?? ''
                st.matchSpec = Object.keys(e)
                    .filter(k => k !== '_')
                    .map(k => `${k} = ${matchValStr(e[k])}`)
                    .join(', ')
            }
        }
        if (raw?.capture && typeof raw.capture === 'object') {
            st.capture = Object.entries(raw.capture as Record<string, unknown>)
                .map(([k, p]) => `${k} = ${String(p)}`)
                .join(', ')
        }
    }
    return st
}

/** Parse an mt-tl-test YAML scenario into builder state (auth `with` kept as-is —
 *  exports mask secrets, so a re-import is paste-ready). */
export function fromScenario(text: string, nid: Nid): ScenarioState {
    const s = (parseYaml(text) ?? {}) as Record<string, any>
    const url = (s.target?.url as string | undefined) ?? ''
    const vars = s.vars && typeof s.vars === 'object' ? JSON.stringify(s.vars) : ''
    const usersObj = (s.users ?? {}) as Record<string, any>
    const users: User[] = Object.keys(usersObj).length
        ? Object.entries(usersObj).map(([name, u]) => {
              const user = emptyUser(name, nid)
              user.layer = u?.layer != null ? String(u.layer) : ''
              if (u?.auth?.recipe) {
                  user.authMode = 'recipe'
                  user.recipe = u.auth.recipe
                  user.with = u.auth.with ? JSON.stringify(u.auth.with) : ''
              } else if (Array.isArray(u?.auth?.steps)) {
                  user.authMode = 'steps'
                  user.authSteps = u.auth.steps.map((raw: any) => parseStep(raw, name, nid))
              }
              return user
          })
        : [emptyUser('user', nid)]
    const fallbackUser = users[0]?.name ?? 'user'
    const steps: Step[] = ((s.steps ?? []) as any[]).map(raw => parseStep(raw, fallbackUser, nid))
    return { url, vars, users, steps }
}

// ── per-method try-it serializers (canonical inline Step, for paste-into-builder) ──

/** A single canonical inline scenario step for a filled try-it call:
 *  `- { invoke: <method>, params: {…}, expect: { _: <resultType> } }`. */
export function scenarioStep(method: string, value: BObject, resultType: string): string {
    const parts = [`invoke: ${method}`]
    const p = paramsInline(value)
    if (p) parts.push(`params: ${p}`)
    parts.push(`expect: { _: ${resultType} }`)
    return `- { ${parts.join(', ')} }`
}

/** Wrap a single inline step into a complete, CLI-runnable minimal scenario. */
export function wrapScenario(url: string, method: string, value: BObject, resultType: string): string {
    return (
        [
            'target:',
            `    url: ${url}`,
            `    schema: ${SCHEMA_PLACEHOLDER}`,
            `    publicKey: ${PUBKEY_PLACEHOLDER}`,
            'steps:',
            `    ${scenarioStep(method, value, resultType)}`,
        ].join('\n') + '\n'
    )
}
