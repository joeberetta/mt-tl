import { noopLogger, type Logger } from '@mt-tl/tl'
import type { RpcForwarder, RpcRequest, RpcResponse } from '../rpc-forwarder.js'

/**
 * Dev fallback forwarder, used when no app is registered: logs the JSON-RPC 2.0
 * envelope the handler *would* receive (info level), then returns NOT_IMPLEMENTED.
 * Wire a real app via `createServer(...).register(app)` to get an
 * {@link InProcessForwarder}.
 */
export class PrintForwarder implements RpcForwarder {
    constructor(private readonly logger: Logger = noopLogger) {}

    async forward(req: RpcRequest): Promise<RpcResponse> {
        this.logger.info('rpc.print', {
            id: req.id,
            method: req.method,
            params: req.params,
            context: req.context,
        })
        return { error: { code: 501, message: 'NOT_IMPLEMENTED' } }
    }
}
