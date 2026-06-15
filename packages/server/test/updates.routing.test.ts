import { describe, it, expect } from 'vitest'
import { InMemoryUpdateBus } from '../src/updates/update-bus.js'
import { InMemoryPresence } from '../src/updates/presence.js'
import { UpdateRouter } from '../src/updates/router.js'
import { PushService } from '../src/updates/push.js'
import { ConnectionRegistry } from '../src/transport/connection-registry.js'
import { NodePresenceBinder } from '../src/updates/presence-binder.js'
import { Connection } from '../src/transport/connection.js'
import type { Responder } from '../src/dispatch/types.js'
import type { TlObject } from '@mt-tl/tl'

const tick = () => new Promise(r => setImmediate(r))

function makeConn(): Connection {
    return new Connection(
        Math.floor(Math.random() * 1e9),
        () => {},
        () => {},
        undefined,
        204,
    )
}

interface Sent {
    conn: Connection
    body: TlObject
    isNotification?: boolean
}

function captureResponder(): { responder: Responder; sent: Sent[] } {
    const sent: Sent[] = []
    const responder: Responder = {
        sendEncrypted(conn, body, opts) {
            sent.push({ conn, body, isNotification: opts?.isNotification })
        },
    }
    return { responder, sent }
}

describe('update routing — worker -> router -> node -> push', () => {
    it('delivers only to nodes that hold the user, as a notification', async () => {
        const bus = new InMemoryUpdateBus()
        const presence = new InMemoryPresence()
        const router = new UpdateRouter(bus, presence)
        router.start()

        const registry = new ConnectionRegistry()
        const { responder, sent } = captureResponder()
        const push = new PushService(registry, responder)
        bus.subscribeNode('nodeA', m => push.deliver(m.subject!, m.update))

        // subject 'u-777' connected on nodeA
        const conn = makeConn()
        registry.register('u-777', conn)
        await presence.add('u-777', 'nodeA')

        await bus.publishUpdate({ subject: 'u-777', update: { _: 'updateShort', pts: 5 } })
        await tick()

        expect(sent).toHaveLength(1)
        expect(sent[0]!.body._).toBe('updateShort')
        expect(sent[0]!.isNotification).toBe(true)
        expect(sent[0]!.conn).toBe(conn)
    })

    it('drops updates for users with no local connection', async () => {
        const bus = new InMemoryUpdateBus()
        const presence = new InMemoryPresence()
        new UpdateRouter(bus, presence).start()

        const registry = new ConnectionRegistry()
        const { responder, sent } = captureResponder()
        bus.subscribeNode('nodeA', m => new PushService(registry, responder).deliver(m.subject!, m.update))

        // presence says nodeA, but registry has no connection for the subject
        await presence.add('u-999', 'nodeA')
        await bus.publishUpdate({ subject: 'u-999', update: { _: 'updateShort' } })
        await tick()

        expect(sent).toHaveLength(0)
    })

    it('fans out to every node holding the user (multi-device)', async () => {
        const bus = new InMemoryUpdateBus()
        const presence = new InMemoryPresence()
        new UpdateRouter(bus, presence).start()

        const regA = new ConnectionRegistry()
        const regB = new ConnectionRegistry()
        const a = captureResponder()
        const b = captureResponder()
        bus.subscribeNode('nodeA', m => new PushService(regA, a.responder).deliver(m.subject!, m.update))
        bus.subscribeNode('nodeB', m => new PushService(regB, b.responder).deliver(m.subject!, m.update))

        regA.register('u-42', makeConn())
        regB.register('u-42', makeConn())
        await presence.add('u-42', 'nodeA')
        await presence.add('u-42', 'nodeB')

        await bus.publishUpdate({ subject: 'u-42', update: { _: 'updateShort' } })
        await tick()

        expect(a.sent).toHaveLength(1)
        expect(b.sent).toHaveLength(1)
    })

    it('honors the shouldDeliver anti-DDoS valve', async () => {
        const bus = new InMemoryUpdateBus()
        const presence = new InMemoryPresence()
        new UpdateRouter(bus, presence, { shouldDeliver: () => false }).start()

        const registry = new ConnectionRegistry()
        const { responder, sent } = captureResponder()
        bus.subscribeNode('nodeA', m => new PushService(registry, responder).deliver(m.subject!, m.update))
        registry.register('u-1', makeConn())
        await presence.add('u-1', 'nodeA')

        await bus.publishUpdate({ subject: 'u-1', update: { _: 'updateShort' } })
        await tick()
        expect(sent).toHaveLength(0)
    })
})

describe('presence binder', () => {
    it('adds presence on bind and removes only when the last local conn is gone', async () => {
        const presence = new InMemoryPresence()
        const registry = new ConnectionRegistry()
        const binder = new NodePresenceBinder('nodeA', registry, presence)

        const c1 = makeConn()
        const c2 = makeConn()
        binder.bind(c1, 'u-55')
        binder.bind(c2, 'u-55')
        expect(await presence.lookup('u-55')).toEqual(['nodeA'])
        expect(registry.getBySubject('u-55')).toHaveLength(2)

        binder.unbind(c1)
        expect(await presence.lookup('u-55')).toEqual(['nodeA']) // c2 still here
        binder.unbind(c2)
        expect(await presence.lookup('u-55')).toEqual([]) // now gone
    })

    it('bind is idempotent for the same subject', () => {
        const presence = new InMemoryPresence()
        const registry = new ConnectionRegistry()
        const binder = new NodePresenceBinder('nodeA', registry, presence)
        const c = makeConn()
        binder.bind(c, 'u-7')
        binder.bind(c, 'u-7')
        expect(registry.size).toBe(1)
    })
})
