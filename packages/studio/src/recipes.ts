import type { BObject } from './client/codec.js'

// Auth "recipes" = the consumer's own login flow, written as a small ES MODULE
// that default-exports `(ctx) => Promise<void>`. Run via a Blob-URL dynamic
// import so the module can `import` its OWN crypto (eosjs-ecc, @noble/curves…)
// from a CDN and SIGN challenges at runtime — nothing auth-related is baked in.
// Mirrors @mt-tl/testing's Recipe contract. Stored in the browser (localStorage).

const KEY = 'mt-tl-studio.recipes'

export interface Recipe {
    name: string
    /** ES module source. `export default async (ctx) => { … }`. */
    code: string
    /** JSON object passed as `ctx.args` (e.g. phone, seed/secret). Saved locally. */
    args: string
}

/** The minimal session surface a recipe drives — satisfied by BrowserSession and StudioSession. */
export interface RecipeSession {
    invoke(method: string, params?: Record<string, unknown>): Promise<BObject>
    expectUpdate?(match: string, timeoutMs?: number): Promise<BObject>
}

/** What an authored recipe receives. The consumer brings crypto via `import` in the module. */
export interface RecipeContext {
    invoke(method: string, params?: Record<string, unknown>): Promise<BObject>
    expectUpdate(match: string, timeoutMs?: number): Promise<BObject>
    args: Record<string, unknown>
    scope: Record<string, unknown>
    set(key: string, value: unknown): void
    get(key: string): unknown
    log(...parts: unknown[]): void
}

// Recipes bundled at build time (`mt-tl-studio build --recipes <dir>` → recipes.json),
// so a consumer can ship ready login flows for their team to reuse.
let builtin: Recipe[] = []
export async function loadBuiltinRecipes(): Promise<void> {
    try {
        const r = await fetch('./recipes.json')
        if (r.ok) {
            const list = (await r.json()) as Recipe[]
            if (Array.isArray(list)) builtin = list
        }
    } catch {
        /* none bundled */
    }
}
export function isBuiltin(name: string): boolean {
    return builtin.some(b => b.name === name)
}

export function localRecipes(): Recipe[] {
    try {
        const raw = localStorage.getItem(KEY)
        return raw ? (JSON.parse(raw) as Recipe[]) : []
    } catch {
        return []
    }
}

/** Built-in (bundled) + locally-authored recipes; a local recipe overrides a built-in
 *  with the same name. saveRecipe/deleteRecipe only touch the LOCAL (localStorage) set. */
export function listRecipes(): Recipe[] {
    const local = localRecipes()
    const localNames = new Set(local.map(r => r.name))
    return [...builtin.filter(b => !localNames.has(b.name)), ...local]
}

export function saveRecipe(recipe: Recipe): void {
    const all = localRecipes().filter(r => r.name !== recipe.name)
    all.push(recipe)
    localStorage.setItem(KEY, JSON.stringify(all))
}

export function deleteRecipe(name: string): void {
    localStorage.setItem(KEY, JSON.stringify(localRecipes().filter(r => r.name !== name)))
}

/**
 * Execute a recipe's ES-module source against a connected session. The module is
 * imported from a Blob URL (so it may `import` its own libraries), and its
 * default export is called with a {@link RecipeContext}. Returns the captured
 * scope (recipes `set(...)` login results there).
 */
export async function runRecipeCode(
    recipe: Recipe,
    session: RecipeSession,
    log?: (line: string) => void,
    extraArgs: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
    // The recipe's own saved args, overlaid with per-call args passed from the
    // scenario (`auth.with` / a step's `with`) — both reach the recipe as ctx.args.
    const baseArgs = recipe.args?.trim() ? (JSON.parse(recipe.args) as Record<string, unknown>) : {}
    const args = { ...baseArgs, ...extraArgs }
    const scope: Record<string, unknown> = {}
    const ctx: RecipeContext = {
        invoke: (m, p = {}) => session.invoke(m, p),
        expectUpdate: (match, t) =>
            session.expectUpdate
                ? session.expectUpdate(match, t)
                : Promise.reject(new Error('this session does not support expectUpdate')),
        args,
        scope,
        set: (k, v) => {
            scope[k] = v
        },
        get: k => scope[k],
        log: (...parts) => log?.(parts.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    }

    const blobUrl = URL.createObjectURL(new Blob([recipe.code], { type: 'text/javascript' }))
    try {
        const mod = (await import(/* @vite-ignore */ blobUrl)) as {
            default?: (c: RecipeContext) => Promise<void>
            recipe?: (c: RecipeContext) => Promise<void>
        }
        const fn = mod.default ?? mod.recipe
        if (typeof fn !== 'function') {
            throw new Error('recipe must `export default async (ctx) => { … }` (or export `recipe`)')
        }
        await fn(ctx)
        return scope
    } finally {
        URL.revokeObjectURL(blobUrl)
    }
}
