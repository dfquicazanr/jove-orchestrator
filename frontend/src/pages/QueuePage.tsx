import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { GcodeUploadPanel } from '../components/GcodeUploadPanel'
import { InfoTooltip } from '../components/InfoTooltip'
import { QueueItemsTable } from '../components/QueueItemsTable'
import { FilamentSafetyMarginHelp } from '../lib/filamentSafetyMarginHelp'
import { parseSafetyMarginPercent, percentToWasteFactor } from '../lib/filamentSafetyMargin'
import type { Printer } from '../types/printer'
import type { QueueItem } from '../types/queue'

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Draft' },
  { id: 'queued', label: 'Queued' },
  { id: 'printing', label: 'Printing' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
] as const

type StatusFilterId = (typeof STATUS_FILTERS)[number]['id']

export function QueuePage() {
  const { me } = useAuth()
  const isManager = me?.role === 'manager'

  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [printers, setPrinters] = useState<Printer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilterId>('all')
  const [safetyMarginPercent, setSafetyMarginPercent] = useState('0')
  const [planning, setPlanning] = useState(false)
  const [busyItemId, setBusyItemId] = useState<number | null>(null)

  const loadQueue = useCallback(async () => {
    setError(null)
    try {
      const data = await apiFetch<QueueItem[]>('/queue/items')
      setItems(data)
    } catch (e) {
      setItems(null)
      setError(e instanceof Error ? e.message : 'Failed to load queue')
    }
  }, [])

  const loadPrinters = useCallback(async () => {
    try {
      const data = await apiFetch<Printer[]>('/printers')
      setPrinters(data)
    } catch {
      setPrinters([])
    }
  }, [])

  useEffect(() => {
    void loadQueue()
    void loadPrinters()
  }, [loadQueue, loadPrinters])

  const filteredItems = useMemo(() => {
    if (!items) return null
    if (statusFilter === 'all') return items
    return items.filter((i) => i.status === statusFilter)
  }, [items, statusFilter])

  const draftCount = useMemo(() => items?.filter((i) => i.status === 'draft').length ?? 0, [items])

  async function onPlan() {
    if (!isManager) return
    const pct = parseSafetyMarginPercent(safetyMarginPercent)
    if (pct === null) {
      setError('Safety margin must be a whole number from 0% to 100%.')
      return
    }
    const wf = percentToWasteFactor(pct)
    setError(null)
    setNotice(null)
    setPlanning(true)
    try {
      const planned = await apiFetch<QueueItem[]>('/queue/plan', {
        method: 'POST',
        json: { waste_factor: wf },
      })
      const assigned = planned.filter((p) => p.status === 'queued').length
      const unassigned = planned.length - assigned
      setNotice(
        unassigned === 0
          ? `Assigned ${assigned} draft job${assigned === 1 ? '' : 's'} to printers.`
          : `Assigned ${assigned} job${assigned === 1 ? '' : 's'}; ${unassigned} still draft (no compatible printer or filament).`,
      )
      await loadQueue()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Planning failed')
    } finally {
      setPlanning(false)
    }
  }

  async function patchItem(item: QueueItem, patch: Record<string, unknown>) {
    setBusyItemId(item.id)
    setError(null)
    try {
      await apiFetch<QueueItem>(`/queue/items/${item.id}`, {
        method: 'PATCH',
        json: patch,
      })
      await loadQueue()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyItemId(null)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Queue</h1>
          <p className="muted">
            Upload jobs, run the planner to assign draft copies to printers, then adjust assignments
            manually.
          </p>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success subtle">{notice}</p> : null}

      {!isManager ? (
        <p className="muted">You are signed in as a viewer. Upload and planning require a manager account.</p>
      ) : null}

      {isManager ? <GcodeUploadPanel onUploaded={() => void loadQueue()} /> : null}

      {isManager ? (
        <section className="card queue-plan-panel">
          <h2>Planner</h2>
          <p className="muted small">
            Matches <strong>draft</strong> jobs to ready printers with compatible material and color.
          </p>
          <div className="queue-plan-controls">
            <label className="queue-waste-label">
              <span className="queue-waste-label-row">
                Filament safety margin
                <InfoTooltip title="Filament safety margin">
                  <FilamentSafetyMarginHelp />
                </InfoTooltip>
              </span>
              <span className="queue-percent-field">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={safetyMarginPercent}
                  disabled={planning}
                  onChange={(e) => setSafetyMarginPercent(e.target.value)}
                  aria-describedby="queue-safety-margin-hint"
                />
                <span className="queue-percent-suffix" aria-hidden>
                  %
                </span>
              </span>
              <span id="queue-safety-margin-hint" className="muted small">
                Extra filament required beyond the G-code estimate (0–100%).
              </span>
            </label>
            <button
              type="button"
              className="btn primary"
              disabled={planning || draftCount === 0}
              onClick={() => void onPlan()}
            >
              {planning ? 'Planning…' : `Assign drafts (${draftCount})`}
            </button>
          </div>
        </section>
      ) : null}

      <section className="queue-list-section">
        <div className="queue-list-head">
          <h2>Jobs</h2>
          <div className="queue-status-filters" role="tablist" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={statusFilter === f.id}
                className={`queue-filter-btn${statusFilter === f.id ? ' active' : ''}`}
                onClick={() => setStatusFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {!items ? <p>Loading…</p> : null}
        {filteredItems && filteredItems.length === 0 ? (
          <p className="muted">No jobs in this view.</p>
        ) : null}
        {filteredItems && filteredItems.length > 0 ? (
          <QueueItemsTable
            items={filteredItems}
            printers={printers}
            isManager={isManager}
            busyItemId={busyItemId}
            onAssignPrinter={(item, printerId) => {
              void patchItem(item, {
                assigned_printer_id: printerId,
                ...(printerId != null && item.status === 'draft' ? { status: 'queued' } : {}),
              })
            }}
            onPriorityChange={(item, priority) => {
              void patchItem(item, { priority })
            }}
            onCancel={(item) => {
              void patchItem(item, { status: 'cancelled' })
            }}
          />
        ) : null}
      </section>
    </div>
  )
}
