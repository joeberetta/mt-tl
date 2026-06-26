// Lazy markdown loader for the chunked doc bundles (scenarios/<slug>.md,
// descriptions/<name>.md, changelog/<N>.md). The CLI emits an index.json per kind
// + one .md per item, so the UI fetches a doc only when it's actually shown —
// see studio-output-optimization-plan.md (lever 3). Fetched bodies are cached
// module-wide, so revisiting a page is instant and never re-hits the network.
import { useEffect, useState } from 'react'

const cache = new Map<string, string>()

/**
 * Fetch a bundled markdown doc once and cache it. Returns `''` until it loads (or
 * on 404 / no URL). Pass `undefined` when there's nothing to load (e.g. a symbol
 * with no authored description) — the hook resolves to `''` without a request.
 */
export function useDoc(url: string | undefined): string {
    const [md, setMd] = useState(() => (url && cache.has(url) ? cache.get(url)! : ''))
    useEffect(() => {
        if (!url) {
            setMd('')
            return
        }
        const cached = cache.get(url)
        if (cached !== undefined) {
            setMd(cached)
            return
        }
        let alive = true
        fetch(url)
            .then(r => (r.ok ? r.text() : ''))
            .then(text => {
                cache.set(url, text)
                if (alive) setMd(text)
            })
            .catch(() => {
                if (alive) setMd('')
            })
        return () => {
            alive = false
        }
    }, [url])
    return md
}
