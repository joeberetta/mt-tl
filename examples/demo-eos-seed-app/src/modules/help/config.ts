import type { Config, DcOption } from '../../generated/schema.js'

/** Tunables for the `help.getConfig` payload (the rest are sane constants). */
export interface ConfigInput {
    thisDc?: number
    dcOptions?: DcOption[]
    /** Host/port advertised as DC 1 when `dcOptions` is not given. */
    dcIp?: string
    dcPort?: number
    meUrlPrefix?: string
    testMode?: boolean
}

/**
 * Builds a complete, wire-valid `config` for `help.getConfig`. `date`/`expires`
 * are placeholders — the handler stamps them per request. Values mirror the
 * legacy server's defaults closely enough for a client to boot.
 */
export function buildConfig(input: ConfigInput = {}): Config {
    const dcOptions: DcOption[] = input.dcOptions ?? [
        {
            _: 'dcOption',
            id: input.thisDc ?? 1,
            ip_address: input.dcIp ?? '127.0.0.1',
            port: input.dcPort ?? 8081,
        },
    ]

    return {
        _: 'config',
        date: 0,
        expires: 0,
        test_mode: input.testMode ?? false,
        this_dc: input.thisDc ?? 1,
        dc_options: dcOptions,
        dc_txt_domain_name: '',
        chat_size_max: 200,
        megagroup_size_max: 200000,
        forwarded_count_max: 100,
        online_update_period_ms: 120000,
        offline_blur_timeout_ms: 5000,
        offline_idle_timeout_ms: 30000,
        online_cloud_timeout_ms: 300000,
        notify_cloud_delay_ms: 30000,
        notify_default_delay_ms: 1500,
        push_chat_period_ms: 60000,
        push_chat_limit: 2,
        saved_gifs_limit: 200,
        edit_time_limit: 172800,
        revoke_time_limit: 172800,
        revoke_pm_time_limit: 172800,
        rating_e_decay: 2419200,
        stickers_recent_limit: 200,
        stickers_faved_limit: 5,
        channels_read_media_period: 604800,
        pinned_dialogs_count_max: 5,
        pinned_infolder_count_max: 100,
        call_receive_timeout_ms: 20000,
        call_ring_timeout_ms: 90000,
        call_connect_timeout_ms: 30000,
        call_packet_timeout_ms: 10000,
        me_url_prefix: input.meUrlPrefix ?? 'https://t.me/',
        caption_length_max: 1024,
        message_length_max: 4096,
        webfile_dc_id: input.thisDc ?? 1,
        disabled_features: [],
    }
}
