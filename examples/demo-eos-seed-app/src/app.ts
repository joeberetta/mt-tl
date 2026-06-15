import { type MTProtoConfig, RpcRegistry, type DispatchDeps, type UpdateEmitter } from '@mt-tl/server'
import { createServer, definePlugin } from './framework.js'
// Services (domain) — modules/
import { buildAuthService } from './modules/auth/index.js'
import { AccountService } from './modules/account/index.js'
import { UserService, InMemoryUserRepo, type UserRepo } from './modules/users/index.js'
import type { EccLib } from './modules/auth/ecc.js'
import type { ConfigInput } from './modules/help/config.js'
// Controllers (routes) — plugins/
import { authPlugin } from './plugins/auth.plugin.js'
import { usersPlugin } from './plugins/users.plugin.js'
import { accountPlugin } from './plugins/account.plugin.js'
import { helpPlugin } from './plugins/help.plugin.js'
import { updatesPlugin } from './plugins/updates.plugin.js'
import { messagesPlugin } from './plugins/messages.plugin.js'
import { walletsPlugin } from './plugins/wallets.plugin.js'

const noopEmitter: UpdateEmitter = { async emit() {}, async emitToAuthKey() {} }
const unixNow = () => Math.floor(Date.now() / 1000)

export interface DemoAppConfig {
    /** Server EOS seed (signs/verifies the auth code). Required. */
    serverSeed: string
    /** User persistence; defaults to in-memory (dev/tests). */
    users?: UserRepo
    /** Override the ECC lib (tests inject a fake to avoid eosjs-ecc). */
    ecc?: EccLib
    config?: ConfigInput
    serverConfig?: Record<string, unknown>
    now?: () => number
}

/**
 * The whole demo app as ONE plugin (the composition root). Two phases:
 *   1. build the **services** (domain layer) — the wiring graph; cross-service
 *      deps are passed by value (`auth`/`account` consume `users`).
 *   2. register the **plugins** (controllers) — handing each the services it needs.
 *
 * Services live in `modules/` (no routes); controllers in `plugins/` (only
 * `app.method`). A controller can compose any services — so cross-cutting routes
 * don't force one module to import another. See docs/guide/adding-methods.md.
 */
export const demoApp = definePlugin<DemoAppConfig>((app, config) => {
    const now = config.now ?? unixNow

    // 1. services
    const users = new UserService(config.users ?? new InMemoryUserRepo())
    const auth = buildAuthService({ users, serverSeed: config.serverSeed, ecc: config.ecc, now })
    const account = new AccountService(users)

    // 2. controllers
    app.register(authPlugin, { auth })
    app.register(usersPlugin, { users })
    app.register(accountPlugin, { account })
    app.register(helpPlugin, { config: config.config, serverConfig: config.serverConfig, now })
    app.register(updatesPlugin, { now })
    app.register(messagesPlugin, { users })
    app.register(walletsPlugin)
})

export interface DemoApp {
    rpc: RpcRegistry
    deps: DispatchDeps
}

/**
 * Compat helper for unit/e2e tests: builds the route registry by running the
 * `demoApp` plugin (no transports). Production uses
 * `createServer(config).register(demoApp, …).listen()` — see main.ts.
 */
export function buildDemoApp(config: DemoAppConfig): DemoApp {
    const registry = new RpcRegistry()
    createServer({} as MTProtoConfig, { registry }).register(demoApp, config)
    return { rpc: registry, deps: { updates: noopEmitter } }
}
