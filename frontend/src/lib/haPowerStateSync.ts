/** Background poll while Farm is open. */
export const HA_POWER_POLL_MS = 8_000

/** Ignore stale HA reads that disagree with a recent local toggle. */
export const HA_POWER_PENDING_MS = 12_000

export type HaPowerPending = { on: boolean; since: number }

export function mergeHaPowerServerStates(
  prev: Map<number, boolean | null>,
  server: Map<number, boolean | null>,
  pending: Map<number, HaPowerPending>,
): Map<number, boolean | null> {
  const next = new Map(prev)
  const now = Date.now()
  for (const [id, on] of server) {
    const p = pending.get(id)
    if (p && now - p.since < HA_POWER_PENDING_MS && on !== p.on) {
      next.set(id, p.on)
      continue
    }
    if (p && (on === p.on || now - p.since >= HA_POWER_PENDING_MS)) {
      pending.delete(id)
    }
    next.set(id, on)
  }
  return next
}

export function haPowerFromResponse(
  powerOn: boolean | null | undefined,
  fallbackOn: boolean,
): boolean {
  return typeof powerOn === 'boolean' ? powerOn : fallbackOn
}
