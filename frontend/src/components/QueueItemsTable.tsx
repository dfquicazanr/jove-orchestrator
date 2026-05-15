import { queueStatusLabel } from '../lib/queueStatusLabels'
import type { Printer } from '../types/printer'
import type { QueueItem } from '../types/queue'

type Props = {
  items: QueueItem[]
  printers: Printer[]
  isManager: boolean
  busyItemId: number | null
  onAssignPrinter: (item: QueueItem, printerId: number | null) => void
  onPriorityChange: (item: QueueItem, priority: number) => void
  onCancel: (item: QueueItem) => void
}

function requirementsLine(item: QueueItem): string {
  const parts = [
    item.gcode_file.required_material?.trim() || null,
    item.gcode_file.required_color?.trim() || null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : '—'
}

export function QueueItemsTable({
  items,
  printers,
  isManager,
  busyItemId,
  onAssignPrinter,
  onPriorityChange,
  onCancel,
}: Props) {
  return (
    <div className="queue-table-wrap">
      <table className="table queue-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Copy</th>
            <th>Requirements</th>
            <th>Est. filament</th>
            <th>Printer</th>
            <th>Priority</th>
            <th>Status</th>
            {isManager ? <th /> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const busy = busyItemId === item.id
            const canEdit = isManager && !busy && item.status !== 'done' && item.status !== 'cancelled'
            return (
              <tr key={item.id} className={item.status === 'draft' ? 'queue-row-draft' : undefined}>
                <td className="queue-cell-file" title={item.gcode_file.original_filename}>
                  {item.gcode_file.original_filename}
                </td>
                <td>{item.copy_index + 1}</td>
                <td className="muted">{requirementsLine(item)}</td>
                <td>
                  {item.gcode_file.filament_mass_grams_estimate != null
                    ? `${item.gcode_file.filament_mass_grams_estimate.toFixed(0)} g`
                    : '—'}
                </td>
                <td>
                  {canEdit ? (
                    <select
                      className="queue-select"
                      value={item.assigned_printer_id ?? ''}
                      disabled={busy}
                      onChange={(e) => {
                        const v = e.target.value
                        onAssignPrinter(item, v === '' ? null : Number(v))
                      }}
                    >
                      <option value="">— Unassigned —</option>
                      {printers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>{item.assigned_printer_name ?? '—'}</span>
                  )}
                </td>
                <td>
                  {canEdit ? (
                    <input
                      type="number"
                      className="queue-priority-input"
                      defaultValue={item.priority}
                      key={`${item.id}-${item.priority}`}
                      disabled={busy}
                      onBlur={(e) => {
                        const n = Number(e.target.value)
                        if (!Number.isNaN(n) && n !== item.priority) onPriorityChange(item, n)
                      }}
                    />
                  ) : (
                    item.priority
                  )}
                </td>
                <td>
                  <span className={`pill ${item.status}`}>{queueStatusLabel(item.status)}</span>
                </td>
                {isManager ? (
                  <td>
                    {canEdit ? (
                      <button
                        type="button"
                        className="btn sm secondary"
                        disabled={busy}
                        onClick={() => onCancel(item)}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
