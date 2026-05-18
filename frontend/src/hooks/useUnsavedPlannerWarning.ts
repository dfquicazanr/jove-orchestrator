import { useCallback, useEffect } from 'react'
import { useBlocker } from 'react-router-dom'

/** Warn when leaving the planner with an unsaved session. */
export function useUnsavedPlannerWarning(active: boolean) {
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        active && currentLocation.pathname !== nextLocation.pathname,
      [active],
    ),
  )

  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [active])

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    const ok = window.confirm(
      'You have an unsaved planner session. Leave this page and discard your plan?',
    )
    if (ok) blocker.proceed()
    else blocker.reset()
  }, [blocker])
}
