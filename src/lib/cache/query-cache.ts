/**
 * query-cache.ts — Stale-while-revalidate cache for Supabase list queries.
 *
 * Why: every dashboard queue page mounted with `loading = true` and an empty
 * list, so each visit showed a spinner for the whole Supabase round-trip even
 * when the user had just been on that page. This cache paints the last known
 * result instantly and refreshes in the background.
 *
 * Design notes:
 *  - Two tiers: an in-memory Map (survives client-side navigation) backed by
 *    `sessionStorage` (survives a full page reload / PWA resume).
 *  - `sessionStorage`, NOT `localStorage`: operational data must not outlive
 *    the browser session, and it is per-tab so a second account in another tab
 *    can never read the first account's rows.
 *  - Cache keys are namespaced per user id (see `cacheKeyFor`) so switching
 *    accounts can never surface the previous user's data.
 *  - This is a render accelerator only — never a source of truth. Every read
 *    is revalidated against Supabase, and all writes still go through Server
 *    Actions with their own RLS + status-machine gates.
 */

export interface CacheEntry<T> {
  data: T
  /** Epoch ms when this entry was written. */
  cachedAt: number
}

/** Entries older than this are refetched before being shown as "fresh". */
export const DEFAULT_MAX_AGE_MS = 30_000

/** Hard ceiling — a stale entry older than this is discarded, not painted. */
export const MAX_STALE_MS = 10 * 60_000

const STORAGE_PREFIX = 'fixflow:q:'

const memory = new Map<string, CacheEntry<unknown>>()

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    // Private mode / blocked storage — memory tier still works.
    return null
  }
}

/** Namespaces a cache key to a user so accounts never share cached rows. */
export function cacheKeyFor(userId: string | null | undefined, key: string): string {
  return `${userId ?? 'anon'}::${key}`
}

export function readCache<T>(key: string): CacheEntry<T> | null {
  const hit = memory.get(key) as CacheEntry<T> | undefined
  if (hit) {
    if (Date.now() - hit.cachedAt > MAX_STALE_MS) {
      clearCache(key)
      return null
    }
    return hit
  }

  const store = storage()
  if (!store) return null

  try {
    const raw = store.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry<T>
    if (
      typeof parsed?.cachedAt !== 'number' ||
      Date.now() - parsed.cachedAt > MAX_STALE_MS
    ) {
      store.removeItem(STORAGE_PREFIX + key)
      return null
    }
    memory.set(key, parsed as CacheEntry<unknown>)
    return parsed
  } catch {
    return null
  }
}

export function writeCache<T>(key: string, data: T): void {
  const entry: CacheEntry<T> = { data, cachedAt: Date.now() }
  memory.set(key, entry as CacheEntry<unknown>)

  const store = storage()
  if (!store) return
  try {
    store.setItem(STORAGE_PREFIX + key, JSON.stringify(entry))
  } catch {
    // Quota exceeded — drop the persistent tier for this key and carry on with
    // the in-memory copy rather than breaking the page.
    try {
      store.removeItem(STORAGE_PREFIX + key)
    } catch {
      /* ignore */
    }
  }
}

export function clearCache(key: string): void {
  memory.delete(key)
  const store = storage()
  if (!store) return
  try {
    store.removeItem(STORAGE_PREFIX + key)
  } catch {
    /* ignore */
  }
}

/**
 * Drops every cached query. Call after a mutation that can affect several
 * queues at once (a JO cancellation cascades into MRS + transmittals), and on
 * sign-out so the next account starts clean.
 */
export function clearAllCache(): void {
  memory.clear()
  const store = storage()
  if (!store) return
  try {
    const doomed: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k?.startsWith(STORAGE_PREFIX)) doomed.push(k)
    }
    doomed.forEach((k) => store.removeItem(k))
  } catch {
    /* ignore */
  }
}

/** True when the entry should be treated as fresh enough to skip a refetch. */
export function isFresh(entry: CacheEntry<unknown> | null, maxAgeMs = DEFAULT_MAX_AGE_MS): boolean {
  return Boolean(entry && Date.now() - entry.cachedAt < maxAgeMs)
}
