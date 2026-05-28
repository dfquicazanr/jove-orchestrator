import type { PrinterControlAction } from '../lib/printerControlActions'

type Props = {
  /** ``true`` on, ``false`` off, ``null``/``undefined`` unknown (HA not linked or unreachable). */
  powerOn?: boolean | null
  disabled?: boolean
  busyAction?: PrinterControlAction | null
  onPowerOn: () => void
  onPowerOff: () => void
  /** Compact row for simple card view; grouped block for advanced panel. */
  variant?: 'bar' | 'inline'
}

function statusHint(powerOn: boolean | null | undefined): string | null {
  if (powerOn === true) return null
  if (powerOn === false) return null
  return 'Unknown (Home Assistant)'
}

export function HaPowerToggle({
  powerOn,
  disabled,
  busyAction,
  onPowerOn,
  onPowerOff,
  variant = 'bar',
}: Props) {
  const isOn = powerOn === true
  const isUnknown = powerOn == null
  const powerBusy = busyAction === 'power_on' || busyAction === 'power_off'
  const controlsDisabled =
    Boolean(disabled) || (busyAction != null && !powerBusy)

  const switchControl = (
    <button
      type="button"
      role="switch"
      className={`ha-power-switch${isOn ? ' is-on' : ''}${isUnknown ? ' is-unknown' : ''}${powerBusy ? ' is-busy' : ''}`}
      aria-checked={isOn}
      aria-label={
        isUnknown
          ? 'Printer hardware power — state unknown in Home Assistant'
          : isOn
            ? 'Printer hardware power on — turn off via Home Assistant'
            : 'Printer hardware power off — turn on via Home Assistant'
      }
      title={
        isUnknown
          ? 'Power state unknown — toggle to turn on via Home Assistant'
          : isOn
            ? 'Turn off printer mains (Home Assistant)'
            : 'Turn on printer mains (Home Assistant)'
      }
      disabled={controlsDisabled || powerBusy}
      onClick={() => {
        if (isOn) onPowerOff()
        else onPowerOn()
      }}
    >
      <span className="ha-power-switch-track" aria-hidden="true">
        <span className="ha-power-switch-thumb" />
      </span>
      <span className="ha-power-switch-text" aria-hidden="true">
        {powerBusy ? '…' : isOn ? 'On' : 'Off'}
      </span>
    </button>
  )

  const unknownHint = statusHint(powerOn)

  if (variant === 'inline') {
    return (
      <div className="printer-advanced-group">
        <div className="printer-ha-power-inline-row">
          <h3 className="printer-advanced-label">
            Power
            {unknownHint ? (
              <span className="printer-ha-power-status muted"> · {unknownHint}</span>
            ) : null}
          </h3>
          {switchControl}
        </div>
      </div>
    )
  }

  return (
    <div className="printer-ha-power-bar">
      <span className="printer-ha-power-label">
        Hardware power
        {unknownHint ? (
          <span className="printer-ha-power-status muted"> · {unknownHint}</span>
        ) : (
          <span className="printer-ha-power-status muted"> · Home Assistant</span>
        )}
      </span>
      {switchControl}
    </div>
  )
}
