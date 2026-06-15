/**
 * A tiny dependency-free structured logger, shared across the MTProto packages
 * (the server engine, the handler layer, and your app — import it for one
 * consistent log style). Levels gate output; fields are key/value context.
 *
 * - `LOG_LEVEL` sets the threshold (`trace`<`debug`<`info`<`warn`<`error`<`silent`).
 * - `LOG_FORMAT=json` emits one JSON object per line (ship to a log pipeline);
 *   anything else is a readable line for local dev.
 * - `LOG_ERROR_STACK=true|false` forces whether `Error.stack` is serialized
 *   (default: on for `pretty`, off for `json` — prod opts in).
 * - `pretty` output is ANSI-colored when stdout is a TTY (dim keys, colored
 *   level) for readability; honors `NO_COLOR` / `FORCE_COLOR`.
 * - Tests default to `silent` (set `LOG_LEVEL` to override).
 *
 * Levels, by convention across this codebase:
 * - `trace` — byte/hex protocol firehose (every recv, framing headers, decrypt).
 * - `debug` — useful protocol events (decoded method, salt re-send, handshake step).
 * - `info`  — request/response one-liners + lifecycle links/unlinks (sockets,
 *             sessions, auth keys, users) + update deliveries.
 * - `warn`  — recoverable anomalies (decode failure, unknown method, integrity
 *             rejection, insecure config).
 * - `error` — a request that failed or an update that could not be delivered.
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent'

const ORDER: Record<LogLevel, number> = {
    trace: 5,
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
    silent: 99,
}

export type Fields = Record<string, unknown>

export interface Logger {
    /** Byte/hex protocol firehose — guard heavy field building with {@link isLevelEnabled}. */
    trace(msg: string, fields?: Fields): void
    debug(msg: string, fields?: Fields): void
    info(msg: string, fields?: Fields): void
    warn(msg: string, fields?: Fields): void
    error(msg: string, fields?: Fields): void
    /** Returns a logger that merges `bindings` into every line (e.g. a scope/conn id). */
    child(bindings: Fields): Logger
    /** True when a message at `level` would be emitted — guard expensive field building. */
    isLevelEnabled(level: LogLevel): boolean
    /** The active threshold level. */
    readonly level: LogLevel
}

export interface LoggerOptions {
    level?: LogLevel
    /** 'json' for machine-readable lines, 'pretty' for humans. */
    format?: 'json' | 'pretty'
    name?: string
    bindings?: Fields
    /**
     * Include `Error.stack` when serializing an Error field. Default: `true` for
     * `pretty` (dev), `false` for `json` (prod opts in). `LOG_ERROR_STACK` overrides.
     */
    errorStack?: boolean
    /**
     * ANSI-color the `pretty` output (dim keys, colored level). Default: auto — on
     * when stdout is a TTY and `NO_COLOR` is unset (off when a custom `write` is
     * given). Never colors `json`.
     */
    color?: boolean
    /** Sink (defaults to stdout/stderr by level). Override in tests. */
    write?: (line: string) => void
}

function defaultLevel(): LogLevel {
    const env = process.env.LOG_LEVEL as LogLevel | undefined
    if (env && env in ORDER) return env
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return 'silent'
    return 'info'
}

function defaultFormat(): 'json' | 'pretty' {
    return process.env.LOG_FORMAT === 'json' ? 'json' : 'pretty'
}

function defaultErrorStack(format: 'json' | 'pretty'): boolean {
    const env = process.env.LOG_ERROR_STACK
    if (env === 'true' || env === '1') return true
    if (env === 'false' || env === '0') return false
    return format === 'pretty'
}

function defaultColor(format: 'json' | 'pretty'): boolean {
    if (format === 'json') return false
    if (process.env.NO_COLOR !== undefined) return false
    if (process.env.FORCE_COLOR) return true
    return !!process.stdout.isTTY
}

// ANSI styling for the pretty (TTY) format.
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GRAY = '\x1b[90m'
const LEVEL_COLOR: Record<Exclude<LogLevel, 'silent'>, string> = {
    trace: '\x1b[90m', // gray
    debug: '\x1b[36m', // cyan
    info: '\x1b[32m', // green
    warn: '\x1b[33m', // yellow
    error: '\x1b[31m', // red
}

function makeSerialize(errorStack: boolean): (value: unknown) => unknown {
    return function serialize(value: unknown): unknown {
        if (value instanceof Error) {
            const base: Fields = { name: value.name, message: value.message }
            if (errorStack && value.stack) base.stack = value.stack
            return base
        }
        if (typeof value === 'bigint') return value.toString()
        return value
    }
}

function prettyFields(fields: Fields, serialize: (v: unknown) => unknown, color: boolean): string {
    const parts: string[] = []
    for (const [k, v] of Object.entries(fields)) {
        const sv = serialize(v)
        const val = typeof sv === 'object' && sv !== null ? JSON.stringify(sv) : String(sv)
        // Dim the key so the eye separates key from value; values stay bright.
        parts.push(color ? `${DIM}${k}=${RESET}${val}` : `${k}=${val}`)
    }
    if (!parts.length) return ''
    // Wider gap between fields when colored (the TTY view we optimize for reading).
    const sep = color ? '  ' : ' '
    return sep + parts.join(sep)
}

export function createLogger(options: LoggerOptions = {}): Logger {
    const level = options.level ?? defaultLevel()
    const format = options.format ?? defaultFormat()
    const errorStack = options.errorStack ?? defaultErrorStack(format)
    // A custom sink (tests/embedders) gets no color unless explicitly asked.
    const color = options.color ?? (options.write ? false : defaultColor(format))
    const name = options.name
    const bindings = options.bindings ?? {}
    const threshold = ORDER[level]
    const serialize = makeSerialize(errorStack)

    const emit = (lvl: Exclude<LogLevel, 'silent'>, msg: string, fields?: Fields) => {
        if (ORDER[lvl] < threshold) return
        const merged: Fields = { ...bindings, ...(fields ?? {}) }
        const write = options.write ?? (lvl === 'error' || lvl === 'warn' ? errLine : outLine)
        if (format === 'json') {
            const obj: Fields = { time: new Date().toISOString(), level: lvl, ...(name ? { name } : {}), msg }
            for (const [k, v] of Object.entries(merged)) obj[k] = serialize(v)
            write(JSON.stringify(obj))
        } else {
            const ts = new Date().toISOString().slice(11, 23)
            const lvlText = lvl.toUpperCase().padEnd(5)
            if (color) {
                const tag = name ? ` ${DIM}[${name}]${RESET}` : ''
                write(
                    `${GRAY}${ts}${RESET} ${LEVEL_COLOR[lvl]}${lvlText}${RESET}${tag} ${BOLD}${msg}${RESET}` +
                        prettyFields(merged, serialize, true),
                )
            } else {
                const tag = name ? ` [${name}]` : ''
                write(`${ts} ${lvlText}${tag} ${msg}` + prettyFields(merged, serialize, false))
            }
        }
    }

    return {
        level,
        trace: (msg, fields) => emit('trace', msg, fields),
        debug: (msg, fields) => emit('debug', msg, fields),
        info: (msg, fields) => emit('info', msg, fields),
        warn: (msg, fields) => emit('warn', msg, fields),
        error: (msg, fields) => emit('error', msg, fields),
        isLevelEnabled: lvl => ORDER[lvl] >= threshold,
        child: extra =>
            createLogger({
                ...options,
                level,
                format,
                errorStack,
                color,
                name,
                bindings: { ...bindings, ...extra },
            }),
    }
}

function outLine(line: string): void {
    process.stdout.write(line + '\n')
}
function errLine(line: string): void {
    process.stderr.write(line + '\n')
}

/** A logger that drops everything (explicit opt-out in tests/embedders). */
export const noopLogger: Logger = {
    level: 'silent',
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    isLevelEnabled: () => false,
    child: () => noopLogger,
}
