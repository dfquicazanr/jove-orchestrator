import { formatFilamentGrams, formatFilamentMeters, formatPrintTime } from '../lib/formatGcodeMeta'
import type { PlannerSessionSummary as Summary } from '../lib/plannerSessionSummary'

type Props = {
  summary: Summary
}

export function PlannerSessionSummary({ summary }: Props) {
  const filamentParts: string[] = []
  if (summary.totalMassGrams != null) {
    filamentParts.push(formatFilamentGrams(summary.totalMassGrams))
  }
  if (summary.totalLengthMm != null) {
    filamentParts.push(formatFilamentMeters(summary.totalLengthMm))
  }

  return (
    <div className="planner-session-summary" aria-label="Session totals">
      <dl className="planner-session-summary-dl">
        <div className="planner-session-summary-item">
          <dt>Jobs</dt>
          <dd>{summary.jobCount}</dd>
        </div>
        <div className="planner-session-summary-item">
          <dt>Total time</dt>
          <dd>
            {summary.totalPrintSeconds > 0 ? formatPrintTime(summary.totalPrintSeconds) : '—'}
            {summary.jobsMissingDuration > 0 ? (
              <span className="planner-session-summary-note">
                {' '}
                ({summary.jobsMissingDuration} without time)
              </span>
            ) : null}
          </dd>
        </div>
        <div className="planner-session-summary-item">
          <dt>Filament (est.)</dt>
          <dd>
            {filamentParts.length > 0 ? filamentParts.join(' · ') : '—'}
            {summary.jobsMissingFilament > 0 ? (
              <span className="planner-session-summary-note">
                {' '}
                ({summary.jobsMissingFilament} unknown)
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      {summary.materials.length > 0 ? (
        <div className="planner-session-summary-materials">
          <span className="planner-session-summary-materials-label">Materials</span>
          <ul className="planner-session-summary-materials-list">
            {summary.materials.map((row) => (
              <li key={row.material}>
                <span className="planner-session-summary-material-name">{row.material}</span>
                <span className="muted small"> · {row.count} job{row.count === 1 ? '' : 's'}</span>
                {row.colors.length > 1 || (row.colors.length === 1 && row.colors[0].label !== '—') ? (
                  <span className="planner-session-summary-colors muted small">
                    {' '}
                    (
                    {row.colors.map((c) => `${c.label}: ${c.count}`).join(', ')}
                    )
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
