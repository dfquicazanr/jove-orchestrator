import {
  fieldLabel,
  type GcodeMetadataPreview,
  type GcodeParseField,
} from '../lib/parseGcodeMetadata'
import { reconcileFilament } from '../lib/filamentEstimate'

const FIELDS: GcodeParseField[] = [
  'filament_mass_grams',
  'filament_length_mm',
  'print_time_seconds',
]

type Props = {
  preview: GcodeMetadataPreview | null
  loading?: boolean
  densityGcm3: number | null
  materialLabel?: string
}

function formatDerivedWeight(densityGcm3: number, materialLabel?: string): string {
  const mat = materialLabel ? `${materialLabel}, ` : ''
  return `length × ${mat}${densityGcm3} g/cm³ (1.75 mm filament)`
}

export function GcodeParseDebugAccordion({
  preview,
  loading,
  densityGcm3,
  materialLabel,
}: Props) {
  if (loading) return null

  const matches = preview?.parseMatches ?? []
  const reconciled = reconcileFilament(
    preview?.filament_mass_grams ?? null,
    preview?.filament_length_mm ?? null,
    densityGcm3,
  )

  return (
    <details className="gcode-parse-debug">
      <summary className="gcode-parse-debug-summary">Parser sources</summary>
      <div className="gcode-parse-debug-body">
        <p className="muted small">
          Scans first 512 KB and last 64 KB of the file (same as upload). First matching line wins
          per field. Weight from length uses the selected material density when no slicer weight
          line is present.
        </p>
        {FIELDS.map((field) => {
          const fieldMatches = matches.filter((m) => m.field === field)
          const rawMass = preview?.filament_mass_grams ?? null
          const rawLength = preview?.filament_length_mm ?? null
          const value =
            field === 'filament_mass_grams'
              ? reconciled.massGrams
              : field === 'filament_length_mm'
                ? reconciled.lengthMm
                : preview?.print_time_seconds ?? null
          const unit =
            field === 'print_time_seconds' ? ' s' : field === 'filament_length_mm' ? ' mm' : ' g'

          const showDerivedWeight =
            field === 'filament_mass_grams' &&
            rawMass == null &&
            reconciled.massFromDensity &&
            rawLength != null &&
            densityGcm3 != null

          return (
            <div key={field} className="gcode-parse-debug-field">
              <div className="gcode-parse-debug-field-head">
                <strong>{fieldLabel(field)}</strong>
                <span className="muted small">
                  {value != null
                    ? `→ ${field === 'filament_mass_grams' ? Math.round(value * 100) / 100 : value}${unit}`
                    : '— not found'}
                </span>
              </div>
              {field === 'filament_mass_grams' && rawMass == null && rawLength != null && !densityGcm3 ? (
                <p className="muted small gcode-parse-debug-empty">
                  No slicer weight line — assign a material with a default density to estimate.
                </p>
              ) : fieldMatches.length === 0 && !showDerivedWeight ? (
                <p className="muted small gcode-parse-debug-empty">
                  No matching comment line in scanned regions.
                </p>
              ) : fieldMatches.length > 0 ? (
                <ul className="gcode-parse-debug-lines">
                  {fieldMatches.map((m, i) => (
                    <li
                      key={`${m.field}-${m.region}-${m.lineNumber}-${i}`}
                      className="gcode-parse-debug-line"
                    >
                      <span className="gcode-parse-debug-loc">
                        Line {m.lineNumber}
                        <span className="gcode-parse-debug-region"> ({m.region})</span>
                      </span>
                      <code className="gcode-parse-debug-pattern">{m.pattern}</code>
                      <span className="gcode-parse-debug-value">= {m.value}</span>
                      <pre className="gcode-parse-debug-text">{m.line}</pre>
                    </li>
                  ))}
                </ul>
              ) : null}
              {showDerivedWeight ? (
                <ul className="gcode-parse-debug-lines">
                  <li className="gcode-parse-debug-line gcode-parse-debug-line--derived">
                    <code className="gcode-parse-debug-pattern">
                      {formatDerivedWeight(densityGcm3, materialLabel)}
                    </code>
                    <span className="gcode-parse-debug-value">
                      = {Math.round(reconciled.massGrams! * 100) / 100} g
                    </span>
                  </li>
                </ul>
              ) : null}
            </div>
          )
        })}
      </div>
    </details>
  )
}
