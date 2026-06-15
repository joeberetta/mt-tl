import type { RpcForwarder, RpcRequest, RpcResponse } from '../rpc-forwarder.js'

/**
 * Forwarder that calls a handler in the same process — for co-locating the
 * gateway and a worker (no broker), and for end-to-end tests. The handler is
 * typically the worker's `dispatchRpc`.
 */
export class InProcessForwarder implements RpcForwarder {
    constructor(private readonly handler: (req: RpcRequest) => Promise<RpcResponse>) {}

    forward(req: RpcRequest): Promise<RpcResponse> {
        return this.handler(req)
    }
}
