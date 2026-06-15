import type { Storage } from './types.js'
import { createMemoryStorage } from './memory.js'

export type { Storage } from './types.js'
export type StorageBackend = 'memory' | 'mongo'

export interface StorageConfig {
    backend: StorageBackend
    mongoUrl?: string
    mongoDb?: string
}

/**
 * Builds the configured storage backend. `memory` (default) needs no external
 * services; `mongo` lazily imports the driver so memory mode stays dependency-free.
 */
export async function createStorage(config: StorageConfig): Promise<Storage> {
    if (config.backend === 'mongo') {
        if (!config.mongoUrl || !config.mongoDb) {
            throw new Error('STORAGE_BACKEND=mongo requires MONGO_URL and MONGO_DB')
        }
        const { createMongoStorage } = await import('./mongo.js')
        return createMongoStorage(config.mongoUrl, config.mongoDb)
    }
    return createMemoryStorage()
}
