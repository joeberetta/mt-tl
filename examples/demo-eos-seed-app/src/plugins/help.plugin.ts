import type { HelpAppUpdate } from '../generated/schema.js'
import { definePlugin } from '../framework.js'
import { buildConfig, type ConfigInput } from '../modules/help/index.js'

const unixNow = () => Math.floor(Date.now() / 1000)

// `help.AppUpdate` collapses to its primary constructor in the generated types;
// the "no update" variant is wire-valid for the field but needs a cast.
const noAppUpdate = { _: 'help.noAppUpdate' } as unknown as HelpAppUpdate

export interface HelpPluginDeps {
    config?: ConfigInput
    serverConfig?: Record<string, unknown>
    now?: () => number
}

/**
 * Help routes (pre-auth config, ported from `core/tl/help/*`). `help.getConfig`
 * returns the canonical `Config` (the gateway re-encodes per layer);
 * `help.getServerConfig` returns a JSON blob.
 */
export const helpPlugin = definePlugin<HelpPluginDeps>((app, deps) => {
    const config = buildConfig(deps.config)
    const serverConfig = deps.serverConfig ?? {}
    const now = deps.now ?? unixNow

    app.method('help.getConfig', { auth: false }, async () => {
        const t = now()
        return { ...config, date: t, expires: t + 3600 }
    })

    app.method('help.getServerConfig', { auth: false }, async () => ({
        _: 'dataJSON',
        data: JSON.stringify({ ...serverConfig, currentTime: now() }),
    }))

    // App-update check. Stub: no update available.
    app.method('help.getAppUpdate', { auth: false }, async () => noAppUpdate)
})
