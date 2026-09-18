'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * RoutePrefetcher — warms the Next.js router cache for the role's primary
 * forms shortly after the shell mounts.
 *
 * `<Link prefetch>` only fires when a link is in the viewport (or hovered), so
 * routes behind the mobile "More" sheet or the desktop overflow scroll were
 * never prefetched. These are exactly the pages each role opens all day, so we
 * fetch their RSC payloads up front and the first navigation is instant.
 *
 * Deliberately conservative:
 *  - waits for an idle callback so it never competes with the initial render;
 *  - honours Save-Data and 2g/slow-2g connections (skips entirely);
 *  - staggers requests so a 4-route warm-up is not a burst.
 */
export function RoutePrefetcher({ hrefs }: { hrefs: string[] }) {
  const router = useRouter()

  useEffect(() => {
    if (!hrefs.length) return

    // Respect data-saver / very slow links — prefetching there costs the user.
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string }
      }
    ).connection
    if (connection?.saveData) return
    if (connection?.effectiveType && /2g/.test(connection.effectiveType)) return

    const timers: number[] = []
    const schedule = () => {
      hrefs.forEach((href, index) => {
        timers.push(
          window.setTimeout(() => {
            try {
              router.prefetch(href)
            } catch {
              // Prefetch is best-effort; never surface an error to the user.
            }
          }, index * 300)
        )
      })
    }

    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }

    let idleHandle: number | undefined
    if (typeof win.requestIdleCallback === 'function') {
      idleHandle = win.requestIdleCallback(schedule, { timeout: 2500 })
    } else {
      timers.push(window.setTimeout(schedule, 1200))
    }

    return () => {
      timers.forEach(window.clearTimeout)
      if (idleHandle !== undefined && typeof win.cancelIdleCallback === 'function') {
        win.cancelIdleCallback(idleHandle)
      }
    }
  }, [hrefs, router])

  return null
}
