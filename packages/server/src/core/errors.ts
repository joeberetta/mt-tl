/**
 * Business errors. `code`/`message` map straight to the gateway's `rpc_error`
 * (Telegram-style: 400/401/404/420/500…). Throw these from handlers; anything
 * else becomes a 500 INTERNAL.
 */
export class AppError extends Error {
    constructor(
        readonly code: number,
        message: string,
    ) {
        super(message)
        this.name = new.target.name
    }
}

/** Invalid input or a violated precondition → `rpc_error 400`. */
export class BadRequestError extends AppError {
    constructor(message = 'BAD_REQUEST') {
        super(400, message)
    }
}

/** Method requires an authorized user but the auth key is anonymous → `rpc_error 401`. */
export class AuthRequiredError extends AppError {
    constructor(message = 'AUTH_KEY_UNREGISTERED') {
        super(401, message)
    }
}

/** The requested entity does not exist → `rpc_error 404`. */
export class NotFoundError extends AppError {
    constructor(message = 'NOT_FOUND') {
        super(404, message)
    }
}

/**
 * Rate-limited → `rpc_error 420 FLOOD_WAIT_<seconds>`. Clients read the number
 * off the message and retry after that many seconds.
 */
export class FloodWaitError extends AppError {
    constructor(seconds: number) {
        super(420, `FLOOD_WAIT_${seconds}`)
    }
}

/** An unexpected server-side failure → `rpc_error 500`. */
export class InternalError extends AppError {
    constructor(message = 'INTERNAL') {
        super(500, message)
    }
}
