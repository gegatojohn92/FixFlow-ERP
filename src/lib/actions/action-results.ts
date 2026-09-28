export interface ActionFailure {
  success: false
  error: string
}

export type ActionResult<T extends object = Record<string, never>> =
  | ({ success: true } & Omit<T, 'success'>)
  | ActionFailure

export function getErrorMessage(err: unknown, fallback = 'Action failed.'): string {
  return err instanceof Error && err.message ? err.message : fallback
}

export function isActionFailure<T extends object>(result: ActionResult<T>): result is ActionFailure {
  return result.success === false
}

export async function runServerAction<T extends object>(
  source: string,
  context: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<ActionResult<T>> {
  try {
    const data = await fn()
    const rest = { ...(data as T & { success?: unknown }) }
    delete rest.success
    return { success: true, ...rest } as { success: true } & Omit<T, 'success'>
  } catch (err) {
    const message = getErrorMessage(err)
    console.error(JSON.stringify({
      level: 'error',
      source,
      message,
      ...context,
      timestamp: new Date().toISOString(),
    }))
    return { success: false, error: message }
  }
}
