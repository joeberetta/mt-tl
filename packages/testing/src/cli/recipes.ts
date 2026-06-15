import { pathToFileURL } from 'node:url'
import type { TestSession } from '../session.js'
import type { Scope, Generators } from './scope.js'

/** Context handed to an auth recipe. */
export interface RecipeContext {
    /** The connected (handshaken) session for this user. */
    session: TestSession
    /** The user's name in the scenario. */
    user: string
    /** Interpolated `auth.with` args from the scenario. */
    args: Record<string, unknown>
    /** Shared scope — recipes capture login results here (e.g. `scope.set('alice.id', id)`). */
    scope: Scope
}

/**
 * An app-supplied login macro. The QA tool is auth-agnostic; recipes are where a
 * consumer encodes their crypto handshake (e.g. EOS: sendCode → sign → signUp).
 * Provide a module exporting a {@link RecipeMap} and pass it via `--recipes`.
 *
 * @example
 * ```ts
 * export const recipes: RecipeMap = {
 *   'eos-signup': async ({ session, args, scope, user }) => {
 *     const sent = await session.invoke('crypto.sendCode', { ... })
 *     const sign = ecc.sign(sent.code, args.seed)
 *     const auth = await session.invoke('crypto.signUp', { ..., sign })
 *     scope.set(`${user}.id`, auth.user.id)
 *   },
 * }
 * ```
 */
export type Recipe = (ctx: RecipeContext) => Promise<void>

export type RecipeMap = Record<string, Recipe>

/** What a `--recipes` module may export: a `recipes` map and/or `generators`
 *  (custom `${...}` tokens). `default` is accepted as the recipes map too. */
export interface RecipeModule {
    recipes: RecipeMap
    generators: Generators
}

/** Dynamically import a `--recipes` module — its `recipes` (or default) map and
 *  its optional `generators` map. */
export async function loadRecipeModule(path: string): Promise<RecipeModule> {
    const mod = (await import(pathToFileURL(path).href)) as {
        recipes?: RecipeMap
        default?: RecipeMap
        generators?: Generators
    }
    const recipes = mod.recipes ?? mod.default
    if (!recipes || typeof recipes !== 'object') {
        throw new Error(
            `recipes module ${path} must export 'recipes' (or default) as a map of name → function`,
        )
    }
    return { recipes, generators: mod.generators ?? {} }
}

/** Back-compat: load just the recipes map. Prefer {@link loadRecipeModule}. */
export async function loadRecipes(path: string): Promise<RecipeMap> {
    return (await loadRecipeModule(path)).recipes
}
