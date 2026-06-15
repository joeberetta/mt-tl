// The envelope types describe what the engine hands the handler layer.
export type { RpcContext, RpcRequest, RpcResponse, SessionEffect } from '@mt-tl/tl'
import type { RpcRequest, RpcResponse } from '@mt-tl/tl'

/**
 * Bridge from a decoded business TL method to its handler. The framework is
 * in-process, so there are two implementations:
 *   - {@link InProcessForwarder} — calls the app's `dispatchRpc` directly (prod
 *     and tests); what `createServer(...).listen()` wires.
 *   - `PrintForwarder` — the dev fallback when no app is registered; logs the
 *     decoded request envelope and returns NOT_IMPLEMENTED.
 */
export interface RpcForwarder {
    forward(req: RpcRequest): Promise<RpcResponse>
}
