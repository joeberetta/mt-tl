import {
    fromJson,
    MigrationRegistry,
    noopLogger,
    type JsonValue,
    type Logger,
    type TlObject,
} from '@mt-tl/tl'
import type { Connection } from '../transport/connection.js'
import type { ConnectionRegistry } from '../transport/connection-registry.js'
import type { Responder } from '../dispatch/types.js'
import type { LayeredRegistry } from '../tl/layered-registry.js'
import { renderUpdateForLayer } from './render.js'

/**
 * Node-side delivery of a routed update to the user's local connections, as an
 * encrypted server notification (msg_id % 4 == 3). Best-effort: if the user has
 * no local connection, the update is dropped (the client recovers via pts).
 *
 * Each connection is rendered for its own negotiated layer: types not
 * representable there become `updateUnsupported` (pts-bearing) or are dropped.
 */
export class PushService {
    private readonly migrations: MigrationRegistry
    private readonly log: Logger

    constructor(
        private readonly registry: ConnectionRegistry,
        private readonly responder: Responder,
        private readonly layered?: LayeredRegistry,
        migrations?: MigrationRegistry,
        logger?: Logger,
    ) {
        this.migrations = migrations ?? new MigrationRegistry()
        this.log = logger ?? noopLogger
    }

    deliver(subject: string, update: JsonValue): void {
        this.deliverTo(this.registry.getBySubject(subject), update, { subject })
    }

    /** Deliver to the connections of a specific auth key (anonymous-capable target). */
    deliverToAuthKey(authKeyId: string, update: JsonValue): void {
        this.deliverTo(this.registry.getByAuthKey(authKeyId), update, { authKeyId })
    }

    private deliverTo(
        conns: Connection[],
        update: JsonValue,
        target: { subject?: string; authKeyId?: string },
    ): void {
        const tl = fromJson(update)
        if (!tl || typeof tl !== 'object' || Array.isArray(tl) || !('_' in tl)) return
        const base = tl as TlObject
        const type = base._

        // Full update payload at debug — "what we're pushing out" (the canonical
        // form, before per-connection layer rendering).
        this.log.debug('update.data', { ...target, type, update })

        // No local connection for the target — best-effort drop (the client recovers
        // via pts on its next getDifference). Expected, so debug not error.
        if (conns.length === 0) {
            this.log.debug('update.nodest', { ...target, type })
            return
        }

        let delivered = 0
        for (const conn of conns) {
            // The client opted out of updates on this connection (invokeWithoutUpdates).
            if (conn.ctx.noUpdates) continue
            // Render canonical → client layer (non-additive), then per-layer representability.
            let body: TlObject | null = this.migrations.down(base, conn.ctx.apiLayer) as TlObject
            if (this.layered?.hasLayers()) {
                body = renderUpdateForLayer(body, conn.ctx.apiLayer, this.layered)
            }
            if (!body) {
                this.log.debug('update.skip', { ...target, type, conn: conn.id, layer: conn.ctx.apiLayer })
                continue
            }
            try {
                this.responder.sendEncrypted(conn, body, { isNotification: true, contentRelated: false })
                delivered++
            } catch (err) {
                this.log.error('update.fail', { ...target, type, conn: conn.id, err })
            }
        }
        if (delivered) this.log.info('update.push', { ...target, type, conns: delivered })
    }
}
