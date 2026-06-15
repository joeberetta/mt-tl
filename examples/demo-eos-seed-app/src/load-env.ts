import { fileURLToPath } from 'node:url'

/**
 * Loads this app's `.env` (its own project root) into `process.env` so the
 * entrypoints are self-sufficient (e.g. launched by a runner with no inherited
 * env). No-op when `.env` is absent or the Node runtime predates
 * `process.loadEnvFile` (20.12+). Keep shell overrides and `.env` consistent.
 * Call this before reading any config. (`src/load-env.ts` → app root is `../`.)
 */
export function loadDotenv(): void {
    try {
        process.loadEnvFile?.(fileURLToPath(new URL('../.env', import.meta.url)))
    } catch {
        // No .env in the app root — rely on the shell environment.
    }
}
