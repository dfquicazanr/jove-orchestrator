import { useRef, useState, type FormEvent } from 'react'
import { parseCopies, uploadGcodeFile } from '../lib/gcodeUpload'

type PendingRow = {
  id: string
  file: File
  copies: string
  material: string
  color: string
}

type Props = {
  onUploaded: () => void
}

function newRow(file: File, defaults: { material: string; color: string }): PendingRow {
  return {
    id: crypto.randomUUID(),
    file,
    copies: '1',
    material: defaults.material,
    color: defaults.color,
  }
}

export function GcodeUploadPanel({ onUploaded }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<PendingRow[]>([])
  const [defaultMaterial, setDefaultMaterial] = useState('')
  const [defaultColor, setDefaultColor] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function addFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.size > 0)
    if (list.length === 0) return
    const defaults = { material: defaultMaterial, color: defaultColor }
    setRows((prev) => {
      const existing = new Set(prev.map((r) => `${r.file.name}:${r.file.size}:${r.file.lastModified}`))
      const added = list
        .filter((f) => !existing.has(`${f.name}:${f.size}:${f.lastModified}`))
        .map((f) => newRow(f, defaults))
      return added.length ? [...prev, ...added] : prev
    })
    setError(null)
    setNotice(null)
  }

  function updateRow(id: string, patch: Partial<PendingRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  function applyDefaultsToAll() {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        material: defaultMaterial,
        color: defaultColor,
      })),
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (rows.length === 0) {
      setError('Add at least one G-code file.')
      return
    }

    for (const row of rows) {
      if (parseCopies(row.copies) === null) {
        setError(`Invalid copies for “${row.file.name}” (use 1–10000).`)
        return
      }
    }

    setError(null)
    setNotice(null)
    setBusy(true)

    let jobsAdded = 0
    const failedIds = new Set<string>()
    const failedMessages: string[] = []
    const fileCount = rows.length

    try {
      for (const row of rows) {
        const copies = parseCopies(row.copies)!
        try {
          const res = await uploadGcodeFile(row.file, {
            copies,
            required_material: row.material.trim() || null,
            required_color: row.color.trim() || null,
          })
          jobsAdded += res.total_copies_requested
        } catch (err) {
          failedIds.add(row.id)
          const msg = err instanceof Error ? err.message : 'Upload failed'
          failedMessages.push(`${row.file.name}: ${msg}`)
        }
      }

      if (jobsAdded > 0) {
        onUploaded()
      }

      if (failedIds.size === 0) {
        setRows([])
        if (fileInputRef.current) fileInputRef.current.value = ''
        setNotice(
          `Added ${jobsAdded} draft job${jobsAdded === 1 ? '' : 's'} from ${fileCount} file${fileCount === 1 ? '' : 's'}.`,
        )
      } else if (jobsAdded > 0) {
        setRows((prev) => prev.filter((r) => failedIds.has(r.id)))
        setNotice(`Added ${jobsAdded} jobs; ${failedIds.size} file${failedIds.size === 1 ? '' : 's'} failed.`)
        setError(failedMessages.join(' · '))
      } else {
        setError(failedMessages.join(' · '))
      }
    } finally {
      setBusy(false)
    }
  }

  const totalCopies = rows.reduce((sum, r) => {
    const n = parseCopies(r.copies)
    return sum + (n ?? 0)
  }, 0)

  return (
    <section className="card queue-upload-panel">
      <h2>Add to queue</h2>
      <p className="muted small">
        Add one or more G-code files, set copies per file, then upload. Each copy becomes a{' '}
        <strong>draft</strong> queue row.
      </p>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success subtle">{notice}</p> : null}

      <form className="queue-upload-batch" onSubmit={(e) => void onSubmit(e)}>
        <div className="queue-upload-defaults">
          <label>
            Default material (new rows)
            <input
              value={defaultMaterial}
              maxLength={64}
              placeholder="PLA"
              disabled={busy}
              onChange={(e) => setDefaultMaterial(e.target.value)}
            />
          </label>
          <label>
            Default color (new rows)
            <input
              value={defaultColor}
              maxLength={128}
              placeholder="red"
              disabled={busy}
              onChange={(e) => setDefaultColor(e.target.value)}
            />
          </label>
          {rows.length > 1 ? (
            <button
              type="button"
              className="btn sm secondary queue-apply-defaults"
              disabled={busy}
              onClick={applyDefaultsToAll}
            >
              Apply defaults to all rows
            </button>
          ) : null}
        </div>

        <div className="queue-upload-toolbar">
          <input
            ref={fileInputRef}
            type="file"
            accept=".gcode,.gco,.bgcode"
            multiple
            disabled={busy}
            className="queue-upload-file-input"
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            Add G-code files…
          </button>
          {rows.length > 0 ? (
            <button
              type="button"
              className="btn sm secondary"
              disabled={busy}
              onClick={() => {
                setRows([])
                setError(null)
                setNotice(null)
              }}
            >
              Clear list
            </button>
          ) : null}
          {rows.length > 0 ? (
            <span className="muted small queue-upload-summary">
              {rows.length} file{rows.length === 1 ? '' : 's'} · {totalCopies} total cop
              {totalCopies === 1 ? 'y' : 'ies'}
            </span>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <div className="queue-upload-table-wrap">
            <table className="table queue-upload-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Copies</th>
                  <th>Material</th>
                  <th>Color</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="queue-upload-filename" title={row.file.name}>
                      {row.file.name}
                    </td>
                    <td>
                      <input
                        type="number"
                        className="queue-upload-copies"
                        min={1}
                        max={10000}
                        value={row.copies}
                        disabled={busy}
                        onChange={(e) => updateRow(row.id, { copies: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="queue-upload-meta"
                        value={row.material}
                        maxLength={64}
                        placeholder="PLA"
                        disabled={busy}
                        onChange={(e) => updateRow(row.id, { material: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="queue-upload-meta"
                        value={row.color}
                        maxLength={128}
                        placeholder="red"
                        disabled={busy}
                        onChange={(e) => updateRow(row.id, { color: e.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn sm secondary"
                        disabled={busy}
                        aria-label={`Remove ${row.file.name}`}
                        onClick={() => removeRow(row.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted queue-upload-empty">No files queued. Use “Add G-code files…” to build a batch.</p>
        )}

        <div className="btn-row">
          <button type="submit" className="btn primary" disabled={busy || rows.length === 0}>
            {busy
              ? 'Uploading…'
              : rows.length === 0
                ? 'Upload batch'
                : `Upload ${rows.length} file${rows.length === 1 ? '' : 's'} (${totalCopies} jobs)`}
          </button>
        </div>
      </form>
    </section>
  )
}
