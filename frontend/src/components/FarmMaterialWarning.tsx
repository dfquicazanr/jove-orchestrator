import { printersWithoutLoadedMaterial } from '../lib/plannerCompatibility'
import type { Printer } from '../types/printer'

type Props = {
  printers: Printer[]
  /** Extra context for managers (planner hint). */
  showPlannerHint?: boolean
}

export function FarmMaterialWarning({ printers, showPlannerHint = true }: Props) {
  const missing = printersWithoutLoadedMaterial(printers)
  if (missing.length === 0) return null

  const names = missing.map((p) => p.name).join(', ')

  return (
    <p className="farm-material-warning" role="status">
      {missing.length === 1 ? (
        <>
          <strong>{names}</strong> has no loaded material set.
        </>
      ) : (
        <>
          <strong>{names}</strong> have no loaded material set.
        </>
      )}{' '}
      Open <strong>Edit → Filament</strong> on each card and choose a material.
      {showPlannerHint ? ' The planner cannot assign jobs to these printers until this is fixed.' : null}
    </p>
  )
}
