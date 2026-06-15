import type { TlObject } from '@mt-tl/tl'

/**
 * Typed views over the immutable MTProto protocol/service constructors.
 *
 * These are the ~30 types the gateway reads/writes directly during the
 * handshake, session setup and service-message handling. They are still
 * encoded/decoded by the generic {@link TlCodec} (the constructors live in the
 * registry); these interfaces just give the gateway code type-safety when it
 * builds or inspects them. `_` is the constructor predicate.
 */

// --- auth key exchange ------------------------------------------------------

export interface ResPQ extends TlObject {
    _: 'resPQ'
    nonce: Buffer // int128
    server_nonce: Buffer // int128
    pq: Buffer // bytes
    server_public_key_fingerprints: bigint[] // Vector<long>
}

export interface PQInnerData extends TlObject {
    _: 'p_q_inner_data' | 'p_q_inner_data_dc' | 'p_q_inner_data_temp' | 'p_q_inner_data_temp_dc'
    pq: Buffer
    p: Buffer
    q: Buffer
    nonce: Buffer
    server_nonce: Buffer
    new_nonce: Buffer // int256
    dc?: number
    expires_in?: number
}

export interface ServerDHParamsOk extends TlObject {
    _: 'server_DH_params_ok'
    nonce: Buffer
    server_nonce: Buffer
    encrypted_answer: Buffer
}

export interface ServerDHParamsFail extends TlObject {
    _: 'server_DH_params_fail'
    nonce: Buffer
    server_nonce: Buffer
    new_nonce_hash: Buffer
}

export interface ServerDHInnerData extends TlObject {
    _: 'server_DH_inner_data'
    nonce: Buffer
    server_nonce: Buffer
    g: number
    dh_prime: Buffer
    g_a: Buffer
    server_time: number
}

export interface ClientDHInnerData extends TlObject {
    _: 'client_DH_inner_data'
    nonce: Buffer
    server_nonce: Buffer
    retry_id: bigint
    g_b: Buffer
}

export interface DhGenOk extends TlObject {
    _: 'dh_gen_ok'
    nonce: Buffer
    server_nonce: Buffer
    new_nonce_hash1: Buffer
}

// --- session / service ------------------------------------------------------

export interface NewSessionCreated extends TlObject {
    _: 'new_session_created'
    first_msg_id: bigint
    unique_id: bigint
    server_salt: bigint
}

export interface RpcResult extends TlObject {
    _: 'rpc_result'
    req_msg_id: bigint
    result: TlObject | boolean
}

export interface RpcError extends TlObject {
    _: 'rpc_error'
    error_code: number
    error_message: string
}

export interface Pong extends TlObject {
    _: 'pong'
    msg_id: bigint
    ping_id: bigint
}

export interface MsgsAck extends TlObject {
    _: 'msgs_ack'
    msg_ids: bigint[]
}

export interface BadServerSalt extends TlObject {
    _: 'bad_server_salt'
    bad_msg_id: bigint
    bad_msg_seqno: number
    error_code: number
    new_server_salt: bigint
}

export interface BadMsgNotification extends TlObject {
    _: 'bad_msg_notification'
    bad_msg_id: bigint
    bad_msg_seqno: number
    error_code: number
}

export interface MsgContainer extends TlObject {
    _: 'msg_container'
    messages: TlObject[]
}

/** Well-known protocol constructor predicates, for branching in the pipeline. */
export const Predicate = {
    req_pq: 'req_pq',
    req_pq_multi: 'req_pq_multi',
    req_DH_params: 'req_DH_params',
    set_client_DH_params: 'set_client_DH_params',
    ping: 'ping',
    ping_delay_disconnect: 'ping_delay_disconnect',
    msgs_ack: 'msgs_ack',
    msgs_state_req: 'msgs_state_req',
    rpc_drop_answer: 'rpc_drop_answer',
    destroy_session: 'destroy_session',
    get_future_salts: 'get_future_salts',
    http_wait: 'http_wait',
    msg_container: 'msg_container',
    gzip_packed: 'gzip_packed',
    invokeWithLayer: 'invokeWithLayer',
    invokeWithoutUpdates: 'invokeWithoutUpdates',
    invokeAfterMsg: 'invokeAfterMsg',
    initConnection: 'initConnection',
} as const
