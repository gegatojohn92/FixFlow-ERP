'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_MAX_AGE_MS,
  clearCache,
  isFresh,
  readCache,
  writeCache,
} from './query-cache'

export interface UseCachedQueryOptions {
  /** Skip the network refetch when the cached entry is younger than this. */
  maxAgeMs?: number
  /** Set false to hold the query (e.g. while the viewer profile is loading). */
  enabled?: boolean
}

export interface UseCachedQueryResult<T> {
  data: T | null
  /** True only on a cold start (no cached data to paint). */
  loading: boolean
  /** True while a background revalidation is in flight. */
  refreshing: boolean
  error: string | null
  /** Refetch, bypassing the freshness window. Use after a mutation. */
  refresh: () => Promise<void>
  /** Optimistically replace the cached data (e.g. after a local edit). */
  mutate: (updater: T | ((current: T | null) => T)) => void
}

/**
 * Stale-while-revalidate data hook for the dashboard queues.
 *
 * Paints the last known result immediately (from the session cache) and
 * revalidates in the background, so returning to a page feels instant instead
 * of showing a full-page spinner on every visit.
 *
 * `key` must already be namespaced per user — see `cacheKeyFor()`. Pass `null`
 * to disable caching entirely for a query (it then behaves as a plain fetch).
 */
export function useCachedQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: UseCachedQueryOptions = {}
): UseCachedQueryResult<T> {
  const { maxAgeMs = DEFAULT_MAX_AGE_MS, enabled = true } = options

  const cached = key ? readCache<T>(key) : null

  const [data, setData] = useState<T | null>(cached?.data ?? null)
  const [loading, setLoading] = useState(!cached && enabled)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Keep the newest fetcher without making it a dependency of the effect —
  // page fetchers are usually inline closures and would otherwise refetch on
  // every render.
  const fetcherRef = useRef(fetcher)
  // Assigning a ref during render is unsafe under concurrent rendering, so the
  // sync happens in an effect. This effect is declared before the one that
  // triggers `run`, so the newest fetcher is always in place before a fetch.
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const run = useCallback(
    async (force: boolean) => {
      if (!enabled) return

      // Yield once so this never sets state synchronously inside an effect
      // body, which would cause a cascading render.
      await Promise.resolve()
      if (!mountedRef.current) return

      const entry = key ? readCache<T>(key) : null
      if (entry) {
        // Paint whatever we have immediately.
        setData(entry.data)
        setLoading(false)
        if (!force && isFresh(entry, maxAgeMs)) return
      }

      if (entry) setRefreshing(true)
      else setLoading(true)
      setError(null)

      try {
        const result = await fetcherRef.current()
        if (!mountedRef.current) return
        setData(result)
        if (key) writeCache(key, result)
      } catch (err) {
        if (!mountedRef.current) return
        const message = err instanceof Error ? err.message : 'Failed to load data.'
        setError(message)
        // A failed revalidation must not poison the cache: drop the entry so
        // the next attempt is a clean cold fetch.
        if (key) clearCache(key)
      } finally {
        if (mountedRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [enabled, key, maxAgeMs]
  )

  useEffect(() => {
    // `run` awaits before touching state, so no setState happens synchronously
    // in this effect body; the rule cannot see through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(false)
  }, [run])

  const refresh = useCallback(() => run(true), [run])

  const mutate = useCallback(
    (updater: T | ((current: T | null) => T)) => {
      setData((current) => {
        const next =
          typeof updater === 'function'
            ? (updater as (c: T | null) => T)(current)
            : updater
        if (key) writeCache(key, next)
        return next
      })
    },
    [key]
  )

  return { data, loading, refreshing, error, refresh, mutate }
}
