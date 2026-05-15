import { preheatControlAction, type PrinterControlAction } from '../lib/printerControlActions'
import { printJobPhase, showPrintJobControls } from '../lib/printJobControls'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import type { Printer } from '../types/printer'

type Props = {
  printer: Printer
  preheatPresets: MaterialPreheatPreset[]
  disabled?: boolean
  busyAction: PrinterControlAction | null
  onAction: (action: PrinterControlAction) => void
}

function ControlBtn({
  label,
  action,
  busyAction,
  disabled,
  onAction,
  danger,
  title,
}: {
  label: string
  action: PrinterControlAction
  busyAction: PrinterControlAction | null
  disabled?: boolean
  onAction: (action: PrinterControlAction) => void
  danger?: boolean
  title?: string
}) {
  const busy = busyAction === action
  return (
    <button
      type="button"
      className={`btn sm${danger ? ' danger' : ' secondary'}`}
      disabled={disabled || (busyAction !== null && !busy)}
      title={title}
      onClick={() => onAction(action)}
    >
      {busy ? '…' : label}
    </button>
  )
}

export function PrinterFarmAdvancedPanel({
  printer,
  preheatPresets,
  disabled,
  busyAction,
  onAction,
}: Props) {
  const hasPower = Boolean(printer.ha_power_entity_id?.trim())
  const jobPhase = printJobPhase(printer.last_known_status)
  const showPrintControls = showPrintJobControls(printer.last_known_status)

  return (
    <div className="printer-advanced-panel">
      <div className="printer-advanced-group">
        <h3 className="printer-advanced-label">Motion</h3>
        <div className="printer-advanced-actions">
          <ControlBtn
            label="Home all"
            action="home"
            busyAction={busyAction}
            disabled={disabled}
            onAction={onAction}
          />
          <ControlBtn
            label="Home XY"
            action="home_xy"
            busyAction={busyAction}
            disabled={disabled}
            onAction={onAction}
          />
        </div>
      </div>

      <div className="printer-advanced-group">
        <h3 className="printer-advanced-label">Heat</h3>
        <div className="printer-advanced-actions">
          {preheatPresets.length === 0 ? (
            <span className="muted small">No presets — configure in Preheat presets…</span>
          ) : (
            preheatPresets.map((preset) => (
              <ControlBtn
                key={preset.id}
                label={preset.name}
                action={preheatControlAction(preset.id)}
                busyAction={busyAction}
                disabled={disabled}
                onAction={onAction}
                title={`Hotend ${preset.hotend_c}°C · Bed ${preset.bed_c}°C`}
              />
            ))
          )}
          <ControlBtn
            label="Cooldown"
            action="cooldown"
            busyAction={busyAction}
            disabled={disabled}
            onAction={onAction}
          />
        </div>
      </div>

      {showPrintControls ? (
        <div className="printer-advanced-group">
          <h3 className="printer-advanced-label">Print</h3>
          <div className="printer-advanced-actions">
            <ControlBtn
              label="Pause"
              action="pause_print"
              busyAction={busyAction}
              disabled={disabled || jobPhase !== 'printing'}
              onAction={onAction}
              title={jobPhase !== 'printing' ? 'Available while printing' : undefined}
            />
            <ControlBtn
              label="Resume"
              action="resume_print"
              busyAction={busyAction}
              disabled={disabled || jobPhase !== 'paused'}
              onAction={onAction}
              title={jobPhase !== 'paused' ? 'Available while paused' : undefined}
            />
            <ControlBtn
              label="Cancel"
              action="cancel_print"
              busyAction={busyAction}
              disabled={disabled}
              onAction={onAction}
              danger
            />
          </div>
        </div>
      ) : null}

      {hasPower ? (
        <div className="printer-advanced-group">
          <h3 className="printer-advanced-label">Power</h3>
          <div className="printer-advanced-actions">
            <ControlBtn
              label="On"
              action="power_on"
              busyAction={busyAction}
              disabled={disabled}
              onAction={onAction}
            />
            <ControlBtn
              label="Off"
              action="power_off"
              busyAction={busyAction}
              disabled={disabled}
              onAction={onAction}
              danger
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
