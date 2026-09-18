'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Loader2 } from 'lucide-react'

/**
 * ActionLock — one global, app-wide guard for every mutating action.
 *
 * Problem it solves: each page hand-rolled a `submitting` boolean that only
 * disabled the single button that started the work. Everything else on the
 * page stayed live, so an operator could double-submit, fire a second action,
 * or navigate mid-write — which matters a great deal in the financial chain of
 * custody (a double "Disburse & Mark Sent" is real money moving twice).
 *
 * `runLocked()` wraps an async action so that, while it runs:
 *   - a full-screen overlay blocks all pointer input and shows what is running;
 *   - concurrent `runLocked()` calls are rejected outright (not queued);
 *   - `beforeunload` warns if the tab is closed mid-write.
 *
 * The overlay is intentionally rendered by the dashboard layout so it covers
 * the header and nav too, not just the page body.
 */

interface ActionLockContextValue {
  isLocked: boolean
  message: string | null
  /**
   * Runs `action` under the global lock.
   * Returns the action's value, or `undefined` if another action was already
   * running (the call is dropped — the UI is blocked, so this is a stray
   * programmatic/duplicate submit).
   */
  runLocked: <T>(message: string, action: () => Promise<T>) => Promise<T | undefined>
}

const ActionLockContext = createContext<ActionLockContextValue | null>(null)

export function ActionLockProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  // A ref guards against the React state update being async: two clicks in the
  // same tick would both see `message === null` otherwise.
  const busyRef = useRef(false)

  const runLocked = useCallback(
    async <T,>(lockMessage: string, action: () => Promise<T>): Promise<T | undefined> => {
      if (busyRef.current) return undefined
      busyRef.current = true
      setMessage(lockMessage)

      const warn = (event: BeforeUnloadEvent) => {
        event.preventDefault()
        event.returnValue = ''
      }
      window.addEventListener('beforeunload', warn)

      try {
        return await action()
      } finally {
        window.removeEventListener('beforeunload', warn)
        busyRef.current = false
        setMessage(null)
      }
    },
    []
  )

  const value = useMemo<ActionLockContextValue>(
    () => ({ isLocked: message !== null, message, runLocked }),
    [message, runLocked]
  )

  return (
    <ActionLockContext.Provider value={value}>
      {children}
      <ActionLockOverlay message={message} />
    </ActionLockContext.Provider>
  )
}

export function useActionLock(): ActionLockContextValue {
  const ctx = useContext(ActionLockContext)
  if (!ctx) {
    throw new Error('useActionLock must be used inside <ActionLockProvider>.')
  }
  return ctx
}

function ActionLockOverlay({ message }: { message: string | null }) {
  if (!message) return null

  return (
    <div
      // aria-busy + role=alert so screen readers announce the blocking state.
      role="alert"
      aria-busy="true"
      aria-live="assertive"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm cursor-wait"
      // Belt and braces: swallow any interaction that reaches the overlay.
      onClickCapture={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onKeyDownCapture={(e) => {
        // Allow nothing except screen-reader navigation keys.
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl px-6 py-5 shadow-2xl flex items-center gap-3.5 max-w-sm mx-4">
        <Loader2 className="w-5 h-5 text-blue-400 animate-spin shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate">{message}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Please wait — do not close or refresh this page.
          </p>
        </div>
      </div>
    </div>
  )
}
