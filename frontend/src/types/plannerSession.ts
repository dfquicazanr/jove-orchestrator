export type PlannerSessionItem = {
  sessionId: string
  gcodeFileId: number
  /** Snapshot for display / assignment before commit. */
  originalFilename: string
  displayName: string
  printTimeSeconds: number | null
  priority: number
  materialPresetId: number | null
  materialPresetName: string | null
  materialColorPresetId: number | null
  materialColorPresetName: string | null
  /** When true, any loaded material on the printer is accepted. */
  matchAnyMaterial: boolean
  /** When true, any loaded color on the printer is accepted. */
  matchAnyColor: boolean
  printKitId: number | null
  kitRunIndex: number | null
  copyLabel: string
}
