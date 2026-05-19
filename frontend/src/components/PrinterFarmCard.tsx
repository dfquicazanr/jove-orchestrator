import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { FilamentSpiralGraphic } from './FilamentSpiralGraphic'
import { PrinterFarmAdvancedPanel } from './PrinterFarmAdvancedPanel'
import type { PrinterControlAction } from '../lib/printerControlActions'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import { PrinterErrorLine } from './PrinterErrorLine'
import type { FarmViewMode } from '../lib/farmViewMode'
import { printerStatusLabel } from '../lib/printerStatusLabels'
import { printerHasRenderableTemps, formatHeaterActualTarget } from '../lib/formatPrinterTemps'
import type { Printer } from '../types/printer'

type Props = {
  printer: Printer
  viewMode?: FarmViewMode
  preheatPresets?: MaterialPreheatPreset[]
  /** Moonraker WebSocket subscription is active for this printer. */
  moonrakerLive?: boolean
  /** Moonraker HTTP/WS reachable — motion, heat, print, send G-code. */
  moonrakerReachable?: boolean
  isManager: boolean
  syncing: boolean
  controlsDisabled?: boolean
  controlBusyAction?: PrinterControlAction | null
  controlFeedback?: { kind: 'ok' | 'err'; text: string } | null
  onControlAction?: (p: Printer, action: PrinterControlAction) => void
  onEditConnection: (p: Printer) => void
  /** Open connection modal focused on the Home Assistant on/off entity field. */
  onEditHaPower?: (p: Printer) => void
  onEditFilament: (p: Printer) => void
  onSendGcode: (p: Printer) => void
  /** Manager: drop a .gcode file onto the card to quick-print. */
  onDropGcode?: (p: Printer, file: File) => void
  onSync: (p: Printer) => void | Promise<void>
  onDelete: (p: Printer) => void
}

export function PrinterFarmCard({
  printer: p,
  viewMode = 'simple',
  preheatPresets = [],
  moonrakerLive,
  moonrakerReachable = true,
  isManager,
  syncing,
  controlsDisabled,
  controlBusyAction = null,
  controlFeedback = null,
  onControlAction,
  onEditConnection,
  onEditHaPower,
  onEditFilament,
  onSendGcode,
  onDropGcode,
  onSync,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteTypeName, setDeleteTypeName] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) {
      setDeleteConfirm(false)
      setDeleteTypeName('')
      return
    }
    function onDoc(ev: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setMenuOpen(false)
        setDeleteConfirm(false)
        setDeleteTypeName('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  useEffect(() => {
    if (deleteConfirm) setDeleteTypeName('')
  }, [deleteConfirm])

  function closeMenu() {
    setMenuOpen(false)
    setDeleteConfirm(false)
    setDeleteTypeName('')
  }

  function runDelete() {
    if (deleteTypeName !== p.name) return
    onDelete(p)
    closeMenu()
  }

  const materialLine = [p.loaded_material.trim() || null, p.loaded_color.trim() || null].filter(Boolean).join(' · ')
  const missingMaterial = !p.loaded_material.trim()
  const statusClass = p.last_known_status
  const showTempStrip =
    moonrakerLive ||
    printerHasRenderableTemps(p)

  const dropEnabled = Boolean(isManager && onDropGcode)

  function acceptGcodeFile(file: File | undefined): file is File {
    if (!file) return false
    const n = file.name.toLowerCase()
    return n.endsWith('.gcode') || n.endsWith('.gco') || n.endsWith('.bgcode')
  }

  return (
    <article
      className={`card printer-card${missingMaterial ? ' printer-card--missing-material' : ''}${dragOver ? ' printer-card--drop-target' : ''}`}
      onDragEnter={
        dropEnabled
          ? (e) => {
              e.preventDefault()
              setDragOver(true)
            }
          : undefined
      }
      onDragOver={
        dropEnabled
          ? (e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              setDragOver(true)
            }
          : undefined
      }
      onDragLeave={
        dropEnabled
          ? (e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return
              setDragOver(false)
            }
          : undefined
      }
      onDrop={
        dropEnabled
          ? (e) => {
              e.preventDefault()
              setDragOver(false)
              const file = e.dataTransfer.files[0]
              if (!acceptGcodeFile(file)) return
              onDropGcode?.(p, file)
            }
          : undefined
      }
    >
      <div className="printer-card-head">
        <div className="printer-card-title">
          <h2>{p.name}</h2>
          <p className="status printer-card-status">
            <span
              className={`pill ${statusClass}${moonrakerLive ? ' moonraker-live' : ''}`}
              title={moonrakerLive ? 'Live status from Moonraker' : undefined}
            >
              {printerStatusLabel(p.last_known_status)}
            </span>
            {p.moonraker_api_key_present ? (
              <span className="pill subtle" title="An API key is stored for this printer">
                API key set
              </span>
            ) : null}
          </p>
          {statusClass === 'error' && p.last_moonraker_error ? (
            <PrinterErrorLine message={p.last_moonraker_error} />
          ) : null}
        </div>
        {isManager ? (
          <div className={`printer-card-menu${menuOpen ? ' printer-card-menu-open' : ''}`} ref={menuRef}>
            <button
              type="button"
              className="btn sm secondary printer-menu-trigger"
              aria-expanded={menuOpen}
              aria-haspopup="true"
              aria-controls={`printer-menu-${p.id}`}
              onClick={() => {
                setMenuOpen((o) => !o)
                setDeleteConfirm(false)
              }}
            >
              Edit
            </button>
            {menuOpen ? (
              <div className="printer-menu-dropdown" id={`printer-menu-${p.id}`} role="menu">
                {!deleteConfirm ? (
                  <>
                    <button
                      type="button"
                      className="printer-menu-item"
                      role="menuitem"
                      onClick={() => {
                        onEditConnection(p)
                        closeMenu()
                      }}
                    >
                      Connection…
                    </button>
                    {onEditHaPower ? (
                      <button
                        type="button"
                        className="printer-menu-item"
                        role="menuitem"
                        onClick={() => {
                          onEditHaPower(p)
                          closeMenu()
                        }}
                      >
                        Link Home Assistant power…
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="printer-menu-item"
                      role="menuitem"
                      disabled={syncing}
                      onClick={() => {
                        void onSync(p)
                        closeMenu()
                      }}
                    >
                      {syncing ? 'Syncing…' : 'Sync from Moonraker'}
                    </button>
                    {moonrakerReachable ? (
                      <button
                        type="button"
                        className="printer-menu-item"
                        role="menuitem"
                        onClick={() => {
                          onSendGcode(p)
                          closeMenu()
                        }}
                      >
                        Send G-code…
                      </button>
                    ) : null}
                    <div className="printer-menu-divider" />
                    <button
                      type="button"
                      className="printer-menu-item printer-menu-item-danger"
                      role="menuitem"
                      onClick={() => setDeleteConfirm(true)}
                    >
                      Delete printer…
                    </button>
                  </>
                ) : (
                  <div className="printer-menu-delete-panel">
                    <p className="printer-menu-delete-text">
                      This removes <strong>{p.name}</strong> from Jove. Moonraker on the device is not stopped.
                    </p>
                    <label className="printer-menu-delete-label">
                      Type the printer name to confirm
                      <input
                        value={deleteTypeName}
                        onChange={(e) => setDeleteTypeName(e.target.value)}
                        autoComplete="off"
                        placeholder={p.name}
                      />
                    </label>
                    <div className="printer-menu-delete-actions">
                      <button
                        type="button"
                        className="btn sm secondary"
                        onClick={() => {
                          setDeleteConfirm(false)
                          setDeleteTypeName('')
                        }}
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        className="btn sm danger"
                        disabled={deleteTypeName !== p.name}
                        onClick={() => runDelete()}
                      >
                        Delete permanently
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className={`filament-zone${isManager ? ' filament-zone-interactive' : ''}`}
        {...(isManager
          ? {
              role: 'button' as const,
              tabIndex: 0,
              onClick: () => onEditFilament(p),
              onKeyDown: (ev: KeyboardEvent) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault()
                  onEditFilament(p)
                }
              },
            }
          : {})}
      >
        <div className="filament-spiral-wrap">
          <FilamentSpiralGraphic remainingGrams={p.remaining_filament_grams} loadedColor={p.loaded_color} />
        </div>
        <div className="filament-zone-meta">
          <div className="filament-zone-footer">
            <span className={`filament-zone-material${missingMaterial ? ' filament-zone-material--warn' : ''}`}>
              {materialLine || 'No material set'}
            </span>
            {missingMaterial ? (
              <span className="filament-zone-hint">Edit → Filament to assign</span>
            ) : null}
            <span className="filament-zone-weight">{p.remaining_filament_grams.toFixed(0)} g remaining</span>
          </div>
        </div>
      </div>

      {showTempStrip ? (
        <dl className="printer-card-temps">
          <dt>Hotend</dt>
          <dd className="printer-card-temp-dd">
            {formatHeaterActualTarget(p.extruder_actual_c, p.extruder_target_c)}
            <span className="printer-card-temp-unit">°C</span>
          </dd>
          <dt>Bed</dt>
          <dd className="printer-card-temp-dd">
            {formatHeaterActualTarget(p.bed_actual_c, p.bed_target_c)}
            <span className="printer-card-temp-unit">°C</span>
          </dd>
        </dl>
      ) : null}

      {p.ha_power_entity_id || (p.last_moonraker_error && statusClass !== 'error') ? (
        <dl className="printer-card-meta">
          {p.ha_power_entity_id ? (
            <>
              <dt>HA power</dt>
              <dd className="truncate" title={p.ha_power_entity_id}>
                {p.ha_power_entity_id}
              </dd>
            </>
          ) : null}
          {p.last_moonraker_error && statusClass !== 'error' ? (
            <>
              <dt>Last error</dt>
              <dd>
                <PrinterErrorLine message={p.last_moonraker_error} />
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {viewMode !== 'advanced' && isManager && p.ha_power_entity_id?.trim() && onControlAction ? (
        <div className="printer-ha-power-bar">
          <span className="printer-ha-power-label">Hardware power</span>
          <div className="printer-ha-power-actions">
            <button
              type="button"
              className="btn sm secondary"
              disabled={Boolean(controlsDisabled) || controlBusyAction !== null}
              title="Home Assistant turn_on on the linked entity"
              onClick={() => onControlAction(p, 'power_on')}
            >
              {controlBusyAction === 'power_on' ? '…' : 'On'}
            </button>
            <button
              type="button"
              className="btn sm danger"
              disabled={Boolean(controlsDisabled) || controlBusyAction !== null}
              title="Requires confirmation — HA turn_off on the linked entity"
              onClick={() => onControlAction(p, 'power_off')}
            >
              {controlBusyAction === 'power_off' ? '…' : 'Off'}
            </button>
          </div>
        </div>
      ) : null}

      {viewMode === 'advanced' ? (
        <PrinterFarmAdvancedPanel
          printer={p}
          preheatPresets={preheatPresets}
          moonrakerReachable={moonrakerReachable}
          disabled={controlsDisabled}
          busyAction={controlBusyAction}
          onAction={(action) => onControlAction?.(p, action)}
        />
      ) : null}
      {controlFeedback ? (
        <p
          className={
            controlFeedback.kind === 'ok'
              ? 'success subtle printer-card-inline-feedback'
              : 'error subtle printer-card-inline-feedback'
          }
          role="status"
          aria-live="polite"
        >
          {controlFeedback.text}
        </p>
      ) : null}
    </article>
  )
}
