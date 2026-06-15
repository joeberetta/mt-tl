import { EventEmitter } from 'node:events'
import type { NodeDelivery, UpdateMessage } from './types.js'

/**
 * Message bus connecting publishers -> Update Router -> server nodes. Two impls:
 * an in-memory one (single process) and a Redis pub/sub one (multi-instance:
 * an `updates.in` channel for emissions and per-node `updates.node.{id}` channels
 * for routed deliveries).
 */
export interface UpdateBus {
    /** Publisher side: emit an update for a user. Fire-and-forget. */
    publishUpdate(msg: UpdateMessage): Promise<void>
    /** Router side: receive all emitted updates. */
    subscribeUpdates(handler: (msg: UpdateMessage) => void): void
    /** Router side: deliver a routed update to a specific node. */
    publishToNode(nodeId: string, msg: NodeDelivery): Promise<void>
    /** Node side: receive deliveries addressed to this node. */
    subscribeNode(nodeId: string, handler: (msg: NodeDelivery) => void): void
    close(): Promise<void>
}

/** In-memory bus (single process / tests). */
export class InMemoryUpdateBus implements UpdateBus {
    private emitter = new EventEmitter()

    constructor() {
        this.emitter.setMaxListeners(0)
    }

    async publishUpdate(msg: UpdateMessage): Promise<void> {
        this.emitter.emit('update', msg)
    }

    subscribeUpdates(handler: (msg: UpdateMessage) => void): void {
        this.emitter.on('update', handler)
    }

    async publishToNode(nodeId: string, msg: NodeDelivery): Promise<void> {
        this.emitter.emit(`node:${nodeId}`, msg)
    }

    subscribeNode(nodeId: string, handler: (msg: NodeDelivery) => void): void {
        this.emitter.on(`node:${nodeId}`, handler)
    }

    async close(): Promise<void> {
        this.emitter.removeAllListeners()
    }
}
