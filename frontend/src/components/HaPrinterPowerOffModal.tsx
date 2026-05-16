import { useEffect } from 'react'
import type { Printer } from '../types/printer'

type Props = {
  printer: Printer | null
  busy: boolean
  onClose: () => void
  onConfirm: (printer: Printer) => void | Promise<void>
}

/** Confirmation before toggling HA-linked hardware off — avoids accidental outage. */
export function HaPrinterPowerOffModal({ printer, busy, onClose, onConfirm }: Props) {
  useEffect(() => {
    if (!printer || busy) return
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [printer, busy, onClose])

  if (!printer) return null

  const entity = printer.ha_power_entity_id?.trim() ?? ''

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(ev) => {
        if (busy) return
        if (ev.target === ev.currentTarget) onClose()
      }}
    >
      <div
        className="modal farm-bulk-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ha-power-off-title"
      >
        <div className="modal-head">
          <h2 id="ha-power-off-title">Turn off printer power?</h2>
          <button
            type="button"
            className="linkish"
            disabled={busy}
            onClick={onClose}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>
        <div className="modal-body farm-bulk-confirm-body">
          <p>
            This tells Home Assistant to run <code className="inline-code">turn_off</code> on{' '}
            <strong>{entity || 'your linked entity'}</strong>.
          </p>
          <p className="muted small">
            <strong>{printer.name}</strong> may lose mains power abruptly (plug, relay, PDU, smart switch,
            dimmable outlet, etc.). Confirm the bed is clear and you intend to shut down hardware —
            not just heaters.
          </p>
        </div>
        <div className="farm-bulk-confirm-actions">
          <button type="button" className="btn secondary" disabled={busy} onClick={onClose} autoFocus>
            Cancel
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => void onConfirm(printer)}>
            {busy ? '…' : 'Turn off'}
          </button>
        </div>
      </div>
    </div>
  )
}
