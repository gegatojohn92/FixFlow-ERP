'use client'

import { useCallback, useState } from 'react'
import { readCache, writeCache, isFresh, DEFAULT_MAX_AGE_MS } from './query-cache'

/**
 * Minimal cache layer for the existing list pages.
 *
 * These pages already own a bespoke fetch function that populates several
 * pieces of state at once, so they cannot adopt `useCachedQuery` without being
 * restructured. `useCachedList` instead wraps only the part that causes the
 * visible cold-start spinner: the primary list and its `loading` flag.
 *
 * Usage inside a page:
 *
 *   const { seed, commit, loading, setLoading } = useCachedList<Row[]>('mrs:list')
 *   const [list, setList] = useState<Row[]>(seed ?? [])
 *   ...inside the fetcher, after a successful load: commit(rows)
 *
 * On a warm cache the page paints the previous rows immediately and refreshes
 * in the background; on a cold cache it behaves exactly as before.
 */
export function useCachedList<T>(key: string | null, maxAgeMs: number = DEFAULT_MAX_AGE_MS) {
  const entry = key ? readCache<T>(key) : null

  // Captured once via a lazy initialiser, so a mid-session cache write never
  // retroactively changes the seed the page initialised its state with.
  const [seed] = useState<T | null>(() => entry?.data ?? null)
  const [hadSeed] = useState(() => !!entry)

  const [loading, setLoading] = useState(() => !entry)
  // A seed that is still fresh needs no background refresh indicator.
  const [refreshing, setRefreshing] = useState(
    () => !!entry && !isFresh(entry, maxAgeMs)
  )

  const commit = useCallback(
    (value: T) => {
      if (key) writeCache(key, value)
      setLoading(false)
      setRefreshing(false)
    },
    [key]
  )

  return {
    seed,
    hadSeed,
    loading,
    setLoading,
    refreshing,
    setRefreshing,
    commit,
  }
}
