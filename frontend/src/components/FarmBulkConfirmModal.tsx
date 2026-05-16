import { useEffect, type ReactNode } from 'react'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import type { Printer } from '../types/printer'

export type FarmBulkConfirmState =
  | { kind: 'home'; targets: Printer[] }
  | {
      kind: 'preheat'
      targets: Printer[]
      preset: MaterialPreheatPreset
    }
  | { kind: 'cooldown'; targets: Printer[] }

function formatPrinterList(names: string[], max = 8): string {
  if (names.length === 0) return '(none)'
  if (names.length <= max) return names.join(', ')
  const head = names.slice(0, max).join(', ')
  return `${head}, … +${names.length - max} more`
}

type Props = {
  state: FarmBulkConfirmState | null
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}

/** Confirm dialog before Farm-wide Moonraker commands (fat-thumb guardrail). */
export function FarmBulkConfirmModal({ state, busy, onConfirm, onClose }: Props) {
  useEffect(() => {
    if (!state || busy) return
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, busy, onClose])

  if (!state) return null

  const n = state.targets.length
  const names = state.targets.map((p) => p.name)

  let title = 'Confirm farm-wide action'
  let body: ReactNode
  let confirmLabel = 'Run on all listed printers'
  let confirmClassName = 'btn primary'

  if (state.kind === 'home') {
    title = 'Home all reachable printers?'
    body = (
      <>
        <p>
          This will run a <strong>full home (G28)</strong> on each of the following{' '}
          <strong>{n}</strong> printer{n === 1 ? '' : 's'}:
        </p>
        <p className="farm-bulk-confirm-names">{formatPrinterList(names)}</p>
        <p className="muted small">Make sure beds are clear — homing moves all axes.</p>
      </>
    )
    confirmLabel = 'Home all'
    confirmClassName = 'btn primary'
  } else if (state.kind === 'preheat') {
    const pre = state.preset
    title = 'Preheat all reachable printers?'
    body = (
      <>
        <p>
          Heat <strong>hotend to {Math.round(pre.hotend_c)}°C</strong> and{' '}
          <strong>bed to {Math.round(pre.bed_c)}°C</strong> — preset <strong>{pre.name}</strong> — on each of
          the following <strong>{n}</strong> printer{n === 1 ? '' : 's'}:
        </p>
        <p className="farm-bulk-confirm-names">{formatPrinterList(names)}</p>
        <p className="muted small">Confirm filament and build surfaces can take these temperatures.</p>
      </>
    )
    confirmLabel = 'Preheat all'
    confirmClassName = 'btn primary'
  } else {
    title = 'Cooldown all reachable printers?'
    body = (
      <>
        <p>
          This will set <strong>M104 / M140 to 0</strong> on each of the following{' '}
          <strong>{n}</strong> printer{n === 1 ? '' : 's'} — hotend and bed heaters off:
        </p>
        <p className="farm-bulk-confirm-names">{formatPrinterList(names)}</p>
        <p className="muted small">
          This can cool down active prints. Use only when you intend to stop heating.
        </p>
      </>
    )
    confirmLabel = 'Cooldown all'
    confirmClassName = 'btn danger'
  }

  const dialogId =
    state.kind === 'home'
      ? 'farm-bulk-confirm-home'
      : state.kind === 'preheat'
        ? 'farm-bulk-confirm-preheat'
        : 'farm-bulk-confirm-cooldown'

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
        aria-labelledby={`${dialogId}-title`}
      >
        <div className="modal-head">
          <h2 id={`${dialogId}-title`}>{title}</h2>
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
        <div className="modal-body farm-bulk-confirm-body">{body}</div>
        <div className="farm-bulk-confirm-actions">
          <button type="button" className="btn secondary" disabled={busy} onClick={onClose} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className={confirmClassName}
            disabled={busy}
            onClick={() => {
              void onConfirm()
            }}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
