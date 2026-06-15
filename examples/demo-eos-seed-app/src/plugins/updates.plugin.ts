import { definePlugin } from '../framework.js'

const unixNow = () => Math.floor(Date.now() / 1000)

export interface UpdatesPluginDeps {
    now?: () => number
}

/**
 * Updates routes. Stub for the alpha: an empty update state is enough for the
 * main screen. Real version ports `core/tl/updates/*` (pts/qts, getDifference).
 */
export const updatesPlugin = definePlugin<UpdatesPluginDeps>((app, { now = unixNow }) => {
    app.method('updates.getState', async () => ({
        _: 'updates.state',
        pts: 0,
        qts: 0,
        date: now(),
        seq: 0,
        unread_count: 0,
    }))
})
