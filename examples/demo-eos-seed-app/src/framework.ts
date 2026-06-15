import {
    createServer as createServerBase,
    definePlugin as definePluginBase,
    type Logger,
    type MTProtoConfig,
    type MigrationRegistry,
    type MtprotoServer,
    type Plugin,
    type RpcRegistry,
} from '@mt-tl/server'
import type { RpcMethods } from './generated/schema.js'

/**
 * This app's framework binding: `createServer` / `definePlugin` pinned to THIS
 * app's generated `RpcMethods`, so `app.method(...)` infers params/result (and
 * checks the method name) per TL method. Modules import `definePlugin` from here.
 * That's how the framework stays schema-agnostic and the app brings its types.
 */
export type AppServer = MtprotoServer<RpcMethods>
export type AppPlugin<D = void> = Plugin<RpcMethods, D>

export function createServer(
    config: MTProtoConfig,
    opts?: { registry?: RpcRegistry; migrations?: MigrationRegistry; logger?: Logger },
): AppServer {
    return createServerBase<RpcMethods>(config, opts)
}

export function definePlugin<D = void>(fn: AppPlugin<D>): AppPlugin<D> {
    return definePluginBase<RpcMethods, D>(fn)
}
