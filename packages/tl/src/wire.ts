import type { JsonValue } from './tl/value.js'
import type { RpcContext, RpcRequest, RpcResponse, SessionEffect } from './rpc.js'

/**
 * Wire format for the gateway↔worker RPC, shared so both sides agree:
 *   request  { jsonrpc, id, method, params, context }
 *   response { result? , error?: { code, message }, effects? }
 * Gateway encodes requests / decodes responses; workers do the inverse.
 */
export function encodeRequest(req: RpcRequest): unknown {
    return {
        jsonrpc: '2.0',
        id: req.id,
        method: req.method,
        params: req.params,
        context: req.context,
    }
}

export function decodeRequest(json: unknown): RpcRequest | null {
    if (!json || typeof json !== 'object') return null
    const o = json as Record<string, unknown>
    if (typeof o.method !== 'string' || !o.context || typeof o.context !== 'object') return null
    return {
        id: o.id === undefined ? '' : String(o.id),
        method: o.method,
        params: (o.params ?? {}) as JsonValue,
        context: o.context as RpcContext,
    }
}

export function encodeResponse(res: RpcResponse): unknown {
    return res
}

export function decodeResponse(json: unknown): RpcResponse {
    if (!json || typeof json !== 'object') {
        return { error: { code: 502, message: 'BAD_RESPONSE' } }
    }
    const o = json as Record<string, unknown>
    const effects = Array.isArray(o.effects) ? (o.effects as SessionEffect[]) : undefined

    if (o.error && typeof o.error === 'object') {
        const e = o.error as Record<string, unknown>
        return {
            error: {
                code: typeof e.code === 'number' ? e.code : 500,
                message: typeof e.message === 'string' ? e.message : 'ERROR',
            },
            effects,
        }
    }
    return { result: o.result as JsonValue, effects }
}
