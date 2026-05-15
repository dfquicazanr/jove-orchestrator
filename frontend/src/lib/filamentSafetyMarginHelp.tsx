/** Copy for the queue planner filament safety margin tooltip. */
export function FilamentSafetyMarginHelp() {
  return (
    <>
      <p>
        Extra headroom on top of the filament grams parsed from the G-code. The planner only assigns
        a job if the printer’s <strong>remaining filament</strong> is at least:
      </p>
      <p className="info-tooltip-formula">estimate × (1 + margin%)</p>
      <ul>
        <li>
          <strong>0%</strong> — use the slicer estimate as-is
        </li>
        <li>
          <strong>15%</strong> — require 15% more on the spool (purge tower, ooze, reprints, low
          estimates)
        </li>
        <li>
          <strong>100%</strong> — require double the estimate (maximum allowed)
        </li>
      </ul>
      <p className="muted small">
        Does not change the stored estimate or what gets printed—only assignment and filament
        deduction on complete.
      </p>
    </>
  )
}
