import { loadDotenv } from './load-env.js'
import { MongoClient } from 'mongodb'
import { createLogger } from '@mt-tl/server'
import { createServer } from './framework.js'
import { demoApp } from './app.js'
import { loadConfig } from './config.js'
import { MongoUserRepo, type UserRepo } from './modules/users/index.js'

// Self-sufficient: read this app's .env before any config (no-op if absent).
loadDotenv()

// One logger for the whole process — handed to the framework (so engine +
// handlers share it) and used directly here for boot/shutdown lines. Level/format
// come from LOG_LEVEL / LOG_FORMAT (see .env.example and docs/guide/observability.md).
const log = createLogger({ name: process.env.NODE_ID || 'demo' })

/**
 * Entrypoint: the MTProto server + this app's handlers in ONE process (no
 * broker). Scale by running more replicas behind a load balancer (state shared
 * in Mongo/Redis). Set CHAT_SERVER_SEED, RSA_PRIVATE_KEY_PATH, and storage env
 * (see .env.example).
 */
async function main(): Promise<void> {
    const config = loadConfig()
    const serverSeed = process.env.CHAT_SERVER_SEED
    if (!serverSeed) {
        log.error('config.missing', { var: 'CHAT_SERVER_SEED', hint: 'the server EOS seed' })
        process.exit(1)
    }

    let users: UserRepo | undefined
    let closeMongo: (() => Promise<void>) | undefined
    if (process.env.MONGO_URL) {
        const client = new MongoClient(process.env.MONGO_URL)
        await client.connect()
        const repo = new MongoUserRepo(client.db(process.env.MONGO_DB ?? 'demo'))
        await repo.ensureIndexes()
        users = repo
        closeMongo = () => client.close()
    } else {
        log.warn('storage.memory', { hint: 'no MONGO_URL — using in-memory users (dev only)' })
    }

    const app = createServer(config, { logger: log }).register(demoApp, {
        serverSeed,
        users,
        config: {
            dcIp: process.env.CONFIG_DC_IP,
            dcPort: process.env.CONFIG_DC_PORT ? Number(process.env.CONFIG_DC_PORT) : undefined,
            meUrlPrefix: process.env.CONFIG_ME_URL_PREFIX,
        },
        serverConfig: process.env.SERVER_CONFIG_JSON ? JSON.parse(process.env.SERVER_CONFIG_JSON) : {},
    })

    await app.listen()
    log.info('server.listen', {
        ws: config.wsPort ?? 'disabled',
        tcp: config.tcpPort ?? 'disabled',
        updates: config.updates.enabled ? 'on' : 'off',
        rsaKey: config.rsaKeyPath ? 'from PEM' : 'ephemeral (dev)',
        methods: app.methods.length,
    })

    const shutdown = async () => {
        await app.close()
        await closeMongo?.().catch(() => {})
        process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
}

main().catch(err => {
    log.error('fatal', { err })
    process.exit(1)
})
