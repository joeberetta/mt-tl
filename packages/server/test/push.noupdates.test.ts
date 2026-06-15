import { describe, it, expect } from 'vitest'
import { PushService } from '../src/updates/push.js'
import type { Connection } from '../src/transport/connection.js'
import type { ConnectionRegistry } from '../src/transport/connection-registry.js'
import type { Responder } from '../src/dispatch/types.js'

// A connection that has (or hasn't) opted out of updates via invokeWithoutUpdates.
const conn = (id: number, noUpdates = false) =>
    ({ id, ctx: { apiLayer: 204, noUpdates } }) as unknown as Connection

describe('PushService — invokeWithoutUpdates', () => {
    it('delivers to normal connections but skips noUpdates ones', () => {
        const delivered: number[] = []
        const responder = {
            sendEncrypted: (c: Connection) => delivered.push((c as unknown as { id: number }).id),
        } as unknown as Responder
        const conns = [conn(1), conn(2, true), conn(3)]
        const registry = { getBySubject: () => conns } as unknown as ConnectionRegistry

        new PushService(registry, responder).deliver('u-7', { _: 'updateTest' })

        expect(delivered.sort()).toEqual([1, 3])
    })
})
