import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiFetch } from '../api/client'
import { HaEntityCombobox } from './HaEntityCombobox'
import type { Printer } from '../types/printer'

type Mode = 'create' | 'edit'

type Props = {
  open: boolean
  mode: Mode
  printer: Printer | null
  /** Default display name when ``mode === 'create'`` (e.g. ``Printer 3``). */
  suggestedName?: string
  /** When editing, scroll the HA power entity field into view (e.g. opened from printer menu). */
  highlightHaPower?: boolean
  onClose: () => void
  onSaved: () => void
  onCreatedContinue?: (printer: Printer) => void
}

function emptyConnectionForm() {
  return {
    name: '',
    moonraker_base_url: '',
    moonraker_api_key: '',
    ha_power_entity_id: '',
  }
}

/** True when the string has a ``foo://`` scheme that is not ``http`` or ``https``. */
function moonrakerUrlHasUnsupportedScheme(trimmed: string): boolean {
  return trimmed.length > 0 && /:\/\//.test(trimmed) && !/^https?:\/\//i.test(trimmed)
}

/**
 * If the user omits a scheme (e.g. ``192.168.0.50:8021``), prepend ``http://`` for LAN Moonraker.
 * Existing ``http://`` / ``https://`` URLs are left as-is. Other schemes are returned unchanged.
 */
function normalizeMoonrakerBaseUrl(trimmed: string): string {
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/:\/\//.test(trimmed)) return trimmed
  return `http://${trimmed}`
}

export function PrinterConnectionModal({
  open,
  mode,
  printer,
  suggestedName,
  highlightHaPower = false,
  onClose,
  onSaved,
  onCreatedContinue,
}: Props) {
  const [form, setForm] = useState(emptyConnectionForm)
  const [clearApiKey, setClearApiKey] = useState(false)
  const [apiKeyTouched, setApiKeyTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testFeedback, setTestFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const haPowerSectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setTestFeedback(null)
    setClearApiKey(false)
    setApiKeyTouched(false)
    if (mode === 'edit' && printer) {
      setForm({
        name: printer.name,
        moonraker_base_url: printer.moonraker_base_url,
        moonraker_api_key: '',
        ha_power_entity_id: printer.ha_power_entity_id ?? '',
      })
    } else {
      setForm({
        ...emptyConnectionForm(),
        name: (suggestedName ?? 'Printer 1').trim() || 'Printer 1',
      })
    }
  }, [open, mode, printer, suggestedName])

  useEffect(() => {
    if (!open || !highlightHaPower || mode !== 'edit') return
    const id = window.requestAnimationFrame(() => {
      const el = haPowerSectionRef.current
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const inp = document.getElementById('conn-ha-power-entity') as HTMLInputElement | null
      if (inp) inp.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [open, highlightHaPower, mode])

  if (!open) return null

  const moonrakerUrlTrimmed = form.moonraker_base_url.trim()
  const urlFilled = moonrakerUrlTrimmed.length > 0
  const urlSchemeUnsupported = moonrakerUrlHasUnsupportedScheme(moonrakerUrlTrimmed)
  const urlOkForMoonraker = urlFilled && !urlSchemeUnsupported

  async function onTest() {
    const t = form.moonraker_base_url.trim()
    if (!t || moonrakerUrlHasUnsupportedScheme(t)) return
    const moonraker_base_url = normalizeMoonrakerBaseUrl(t)
    setError(null)
    setTestFeedback(null)
    setTestBusy(true)
    try {
      const moonraker_api_key = form.moonraker_api_key.trim() || null
      const res = await apiFetch<{ ok: boolean; message?: string | null }>('/printers/test-connection', {
        method: 'POST',
        json: {
          moonraker_base_url,
          moonraker_api_key,
        },
      })
      if (res.ok) {
        setTestFeedback({ ok: true, text: 'Moonraker responded OK.' })
      } else {
        setTestFeedback({ ok: false, text: res.message ?? 'Moonraker check failed.' })
      }
    } catch (err) {
      setTestFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Test failed',
      })
    } finally {
      setTestBusy(false)
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const t = form.moonraker_base_url.trim()
    if (moonrakerUrlHasUnsupportedScheme(t)) {
      return
    }
    const moonraker_base_url = normalizeMoonrakerBaseUrl(t)
    setBusy(true)
    try {
      if (mode === 'create') {
        const moonraker_api_key = form.moonraker_api_key.trim() || null
        const ha = form.ha_power_entity_id.trim() || null
        const created = await apiFetch<Printer>('/printers', {
          method: 'POST',
          json: {
            name: form.name.trim(),
            moonraker_base_url,
            moonraker_api_key,
            ha_power_entity_id: ha,
            loaded_material: '',
            loaded_color: '',
            remaining_filament_grams: 0,
          },
        })
        onSaved()
        onClose()
        onCreatedContinue?.(created)
      } else if (printer) {
        const patch: Record<string, unknown> = {
          name: form.name.trim(),
          moonraker_base_url,
          ha_power_entity_id: form.ha_power_entity_id.trim() || null,
        }
        if (clearApiKey) {
          patch.moonraker_api_key = null
        } else if (apiKeyTouched && form.moonraker_api_key.trim()) {
          patch.moonraker_api_key = form.moonraker_api_key.trim()
        }
        await apiFetch<Printer>(`/printers/${printer.id}`, {
          method: 'PATCH',
          json: patch,
        })
        onSaved()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const title =
    mode === 'create' ? 'Add printer' : highlightHaPower ? 'Home Assistant power' : 'Printer connection'

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="conn-modal-title">
        <div className="modal-head">
          <h2 id="conn-modal-title">{title}</h2>
          <button type="button" className="linkish" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form className="modal-body" onSubmit={onSubmit}>
          {error ? <p className="error">{error}</p> : null}

          <label>
            Display name
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              maxLength={128}
              autoComplete="off"
            />
          </label>

          <label>
            Moonraker base URL
            <input
              value={form.moonraker_base_url}
              onChange={(e) => {
                setForm((f) => ({ ...f, moonraker_base_url: e.target.value }))
                setTestFeedback(null)
              }}
              onBlur={() => {
                setForm((f) => {
                  const raw = f.moonraker_base_url
                  const t = raw.trim()
                  if (!t || moonrakerUrlHasUnsupportedScheme(t)) return f
                  const n = normalizeMoonrakerBaseUrl(t)
                  return n !== raw ? { ...f, moonraker_base_url: n } : f
                })
              }}
              required
              maxLength={512}
              placeholder="la-porqueriza:8011 or http://192.168.0.50:7125"
              autoComplete="off"
              aria-invalid={urlSchemeUnsupported}
            />
            {urlSchemeUnsupported ? (
              <span className="error subtle" role="alert">
                Only http:// and https:// are supported for Moonraker (not other URL schemes).
              </span>
            ) : null}
          </label>

          <label>
            Moonraker API key (optional)
            <input
              type="password"
              value={form.moonraker_api_key}
              onChange={(e) => {
                setApiKeyTouched(true)
                setForm((f) => ({ ...f, moonraker_api_key: e.target.value }))
                setTestFeedback(null)
              }}
              maxLength={512}
              autoComplete="new-password"
              placeholder={
                mode === 'edit' && printer?.moonraker_api_key_present ? 'Leave blank to keep current key' : ''
              }
            />
          </label>

          {mode === 'edit' && printer?.moonraker_api_key_present ? (
            <label className="checkbox">
              <input type="checkbox" checked={clearApiKey} onChange={(e) => setClearApiKey(e.target.checked)} />
              Remove stored Moonraker API key
            </label>
          ) : null}

          <div ref={haPowerSectionRef} className="ha-connection-power-block">
            <label>
              Home Assistant on/off entity (optional)
              <HaEntityCombobox
                id="conn-ha-power-entity"
                active={open}
                value={form.ha_power_entity_id}
                maxLength={256}
                placeholder="switch.plug · light.outlet · input_boolean.relay"
                disabled={busy}
                onChange={(ha_power_entity_id) => setForm((f) => ({ ...f, ha_power_entity_id }))}
              />
            </label>
            <p className="muted small">
              Choices load automatically from Home Assistant (<code className="inline-code">switch</code>,{' '}
              <code className="inline-code">light</code>, <code className="inline-code">input_boolean</code>,{' '}
              <code className="inline-code">fan</code>) once this dialog opens. Jove calls{' '}
              <code className="inline-code">turn_on</code> / <code className="inline-code">turn_off</code>. Set the HA URL
              and token in Farm <strong>Controls</strong> → <strong>Home Assistant…</strong>
            </p>
          </div>

          {testFeedback ? (
            <p className={`test-hint ${testFeedback.ok ? 'ok' : 'warn'}`}>{testFeedback.text}</p>
          ) : null}

          <div className="btn-row">
            {urlOkForMoonraker ? (
              <button type="button" className="btn secondary" disabled={busy || testBusy} onClick={() => void onTest()}>
                {testBusy ? 'Testing…' : 'Test'}
              </button>
            ) : null}
            <button type="submit" className="btn primary" disabled={busy || testBusy || urlSchemeUnsupported}>
              {busy ? 'Saving…' : mode === 'create' ? 'Create printer' : 'Save connection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
