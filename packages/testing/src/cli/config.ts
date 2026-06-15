import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import type { Scenario, TargetSpec, UserSpec } from './scenario.js'

/**
 * A per-stand overlay: overrides the scenario's `target` (e.g. `url`), `vars`
 * (e.g. credentials), and per-user `auth` args. Run the SAME scenario against a
 * different stand by swapping `--config`.
 */
export interface OverlayConfig {
    target?: Partial<TargetSpec>
    vars?: Record<string, unknown>
    users?: Record<string, UserSpec>
}

/** Parse a YAML config-overlay file. */
export function loadConfig(path: string): OverlayConfig {
    const raw = parseYaml(readFileSync(path, 'utf8')) as unknown
    if (raw && typeof raw !== 'object') throw new Error(`${path}: config must be a mapping`)
    return (raw ?? {}) as OverlayConfig
}

/** Deep-merge an overlay onto a scenario (overlay wins); returns a new scenario. */
export function applyOverlay(scenario: Scenario, overlay: OverlayConfig): Scenario {
    return {
        ...scenario,
        target: { ...scenario.target, ...overlay.target },
        vars: deepMerge(scenario.vars ?? {}, overlay.vars ?? {}),
        users: deepMerge(scenario.users ?? {}, overlay.users ?? {}) as Scenario['users'],
        steps: scenario.steps,
    }
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...a }
    for (const [k, v] of Object.entries(b)) {
        const prev = out[k]
        if (isPlainObject(prev) && isPlainObject(v)) out[k] = deepMerge(prev, v)
        else out[k] = v
    }
    return out
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v)
}
