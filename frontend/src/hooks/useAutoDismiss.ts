import { useEffect } from 'react'

/** How long success toasts stay visible before clearing. */
export const FARM_SUCCESS_TOAST_MS = 5000

/**
 * Clears `value` by calling `onDismiss` after `delayMs` whenever `value` becomes non-empty.
 * Resets the timer if `value` changes before dismissal.
 */
export function useAutoDismiss(
  value: string | null | undefined,
  onDismiss: () => void,
  delayMs: number = FARM_SUCCESS_TOAST_MS,
) {
  useEffect(() => {
    if (!value) return
    const id = window.setTimeout(onDismiss, delayMs)
    return () => window.clearTimeout(id)
  }, [value, onDismiss, delayMs])
}
