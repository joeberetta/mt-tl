// Auth recipes for the demo's EOS login, for `mtproto-test --recipes`. The QA
// tool is auth-agnostic; this is where THIS app encodes its crypto handshake
// (sendCode → sign the code with the user's EOS key → signUp/signIn). Point the
// CLI at this file and reference a recipe from a scenario's `user.auth.recipe`.
//
//   mtproto-test run testing/chat.scenario.yaml --recipes testing/recipes.ts
//
// Each recipe takes its inputs from `auth.with` (interpolated) — at minimum a
// `seed` (the user's EOS seed) — and captures the resulting user id into the
// scope as `<user>.id`, so later steps can use `${alice.id}`.

import type { TlObject } from '@mt-tl/tl'
import type { RecipeMap, RecipeContext } from '@mt-tl/testing/cli'
import { loadEcc } from '../src/index.js'

const ecc = loadEcc()

interface SentCode {
    code: string
    server_sign: string
    key_registered: boolean
}

export const recipes: RecipeMap = {
    /** Register a brand-new user (fails if the key is already known). */
    'eos-signup': async ctx => {
        const { priv, pub } = keypair(ctx)
        await signUp(ctx, pub, priv, await sendCode(ctx, pub))
    },
    /** Sign an existing user in (the key must already be registered). */
    'eos-signin': async ctx => {
        const { priv, pub } = keypair(ctx)
        await signIn(ctx, pub, priv, await sendCode(ctx, pub))
    },
    /** Sign in if the key is known, otherwise sign up — the convenient default. */
    'eos-auth': async ctx => {
        const { priv, pub } = keypair(ctx)
        const sent = await sendCode(ctx, pub)
        if (sent.key_registered) await signIn(ctx, pub, priv, sent)
        else await signUp(ctx, pub, priv, sent)
    },
}

function keypair(ctx: RecipeContext): { priv: string; pub: string } {
    const seed = ctx.args.seed
    if (!seed) throw new Error(`recipe for user '${ctx.user}': missing 'seed' in auth.with`)
    const priv = ecc.seedPrivate(String(seed))
    return { priv, pub: ecc.privateToPublic(priv) }
}

async function sendCode(ctx: RecipeContext, pub: string): Promise<SentCode> {
    const sent = (await ctx.session.invoke('crypto.sendCode', {
        public_key: pub,
        api_id: 1,
        api_hash: 'qa',
    })) as TlObject
    return {
        code: String(sent.code),
        server_sign: String(sent.server_sign),
        key_registered: Boolean(sent.key_registered),
    }
}

async function signUp(ctx: RecipeContext, pub: string, priv: string, sent: SentCode): Promise<void> {
    const auth = (await ctx.session.invoke('crypto.signUp', {
        public_key: pub,
        code: sent.code,
        server_sign: sent.server_sign,
        sign: ecc.sign(sent.code, priv),
        phone_number: str(ctx.args.phone_number, ''),
        first_name: str(ctx.args.first_name, ctx.user),
        last_name: str(ctx.args.last_name, ''),
        email: str(ctx.args.email, `${ctx.user}@example.com`),
        username: str(ctx.args.username, ctx.user),
    })) as TlObject
    captureUserId(ctx, auth)
}

async function signIn(ctx: RecipeContext, pub: string, priv: string, sent: SentCode): Promise<void> {
    const auth = (await ctx.session.invoke('crypto.signIn', {
        public_key: pub,
        code: sent.code,
        server_sign: sent.server_sign,
        sign: ecc.sign(sent.code, priv),
    })) as TlObject
    captureUserId(ctx, auth)
}

function captureUserId(ctx: RecipeContext, auth: TlObject): void {
    const user = auth.user as TlObject | undefined
    if (!user) return
    if ('id' in user) ctx.scope.set(`${ctx.user}.id`, user.id)
    if ('username' in user) ctx.scope.set(`${ctx.user}.username`, user.username)
}

function str(v: unknown, fallback: string): string {
    return v === undefined || v === null ? fallback : String(v)
}
