import type { JsonValue } from '@mt-tl/tl'

/**
 * An update to deliver, addressed to exactly one target: a bound `subject` (the
 * common case) OR an `authKeyId` (a specific, possibly anonymous, connection —
 * e.g. pushing API to a not-yet-registered client). Set one.
 */
export interface UpdateMessage {
    /** The subject (internal user id) to deliver to. */
    subject?: string
    /** Decimal auth-key id, to address a specific (possibly anonymous) connection. */
    authKeyId?: string
    /** A TL update object as tagged JSON ({ _: name, ... }). */
    update: JsonValue
}

/** A routed delivery from the Update Router to a specific gateway node. */
export interface NodeDelivery {
    subject?: string
    authKeyId?: string
    update: JsonValue
}
