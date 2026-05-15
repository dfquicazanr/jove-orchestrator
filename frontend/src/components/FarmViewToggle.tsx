import type { FarmViewMode } from '../lib/farmViewMode'

type Props = {
  mode: FarmViewMode
  onChange: (mode: FarmViewMode) => void
  disabled?: boolean
}

export function FarmViewToggle({ mode, onChange, disabled }: Props) {
  return (
    <div className="farm-view-toggle" role="group" aria-label="Farm view">
      <button
        type="button"
        className={`farm-view-toggle-btn${mode === 'simple' ? ' active' : ''}`}
        aria-pressed={mode === 'simple'}
        disabled={disabled}
        onClick={() => onChange('simple')}
      >
        Overview
      </button>
      <button
        type="button"
        className={`farm-view-toggle-btn${mode === 'advanced' ? ' active' : ''}`}
        aria-pressed={mode === 'advanced'}
        disabled={disabled}
        onClick={() => onChange('advanced')}
      >
        Controls
      </button>
    </div>
  )
}
