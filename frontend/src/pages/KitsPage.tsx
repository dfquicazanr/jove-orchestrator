import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { gcodeFileLabel } from '../lib/gcodeLabels'
import type { GCodeFile } from '../types/gcode'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import { MOCK_PREHEAT_PRESETS } from '../types/materialPreheat'
import { resolveSessionItemColor } from '../lib/plannerRequirements'
import { appendPlannerImport } from '../lib/plannerSessionStorage'
import { randomId } from '../lib/randomId'
import type { PlannerSessionItem } from '../types/plannerSession'
import type { PrintKit, PrintKitItemDraft } from '../types/printKit'

type ItemRow = PrintKitItemDraft & { key: string }

function newItemRow(files: GCodeFile[], materials: MaterialPreheatPreset[]): ItemRow {
  const f = files[0]
  return {
    key: randomId(),
    gcode_file_id: f?.id ?? 0,
    material_preset_id: f?.material_preset_id ?? materials[0]?.id ?? 0,
    material_color_preset_id: f?.material_color_preset_id ?? null,
    quantity: 1,
  }
}

function newSessionId(): string {
  return randomId()
}

export function KitsPage() {
  const { me } = useAuth()
  const isManager = me?.role === 'manager'
  const navigate = useNavigate()

  const [kits, setKits] = useState<PrintKit[] | null>(null)
  const [files, setFiles] = useState<GCodeFile[]>([])
  const [materials, setMaterials] = useState<MaterialPreheatPreset[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [itemRows, setItemRows] = useState<ItemRow[]>([])
  const [kitCopies, setKitCopies] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setError(null)
    try {
      const [kitData, fileData, matData] = await Promise.all([
        apiFetch<PrintKit[]>('/kits'),
        apiFetch<GCodeFile[]>('/gcode/files'),
        apiFetch<MaterialPreheatPreset[]>('/settings/material-preheat'),
      ])
      setKits(kitData)
      setFiles(fileData)
      setMaterials(matData)
      setSelectedId((prev) => {
        if (prev != null && kitData.some((k) => k.id === prev)) return prev
        return kitData[0]?.id ?? null
      })
    } catch (e) {
      setKits(null)
      setMaterials(MOCK_PREHEAT_PRESETS)
      setError(e instanceof Error ? e.message : 'Failed to load kits')
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const selected = kits?.find((k) => k.id === selectedId) ?? null

  function startNew() {
    setEditing(true)
    setSelectedId(null)
    setName('')
    setDescription('')
    setItemRows(files.length && materials.length ? [newItemRow(files, materials)] : [])
  }

  function startEdit(kit: PrintKit) {
    setEditing(true)
    setSelectedId(kit.id)
    setName(kit.name)
    setDescription(kit.description ?? '')
    setItemRows(
      kit.items.map((i) => ({
        key: String(i.id),
        gcode_file_id: i.gcode_file_id,
        material_preset_id: i.material_preset_id,
        material_color_preset_id: i.material_color_preset_id,
        quantity: i.quantity,
      })),
    )
  }

  function cancelEdit() {
    setEditing(false)
    if (kits?.length) setSelectedId(kits[0].id)
  }

  async function saveKit(e: FormEvent) {
    e.preventDefault()
    if (!isManager) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Kit name is required.')
      return
    }
    if (itemRows.length === 0) {
      setError('Add at least one G-code file to the kit.')
      return
    }
    for (const row of itemRows) {
      if (!row.gcode_file_id || !row.material_preset_id) {
        setError('Each row needs a file and material.')
        return
      }
      if (row.quantity < 1) {
        setError('Quantity must be at least 1.')
        return
      }
    }

    const payload = {
      name: trimmed,
      description: description.trim() || null,
      items: itemRows.map((r, i) => ({
        gcode_file_id: r.gcode_file_id,
        material_preset_id: r.material_preset_id,
        material_color_preset_id: r.material_color_preset_id,
        quantity: r.quantity,
        sort_order: i,
      })),
    }

    setBusy(true)
    setError(null)
    try {
      if (selectedId != null) {
        await apiFetch<PrintKit>(`/kits/${selectedId}`, { method: 'PUT', json: payload })
        setNotice(`Kit “${trimmed}” updated.`)
      } else {
        await apiFetch<PrintKit>('/kits', { method: 'POST', json: payload })
        setNotice(`Kit “${trimmed}” created.`)
      }
      setEditing(false)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function deleteKit(kit: PrintKit) {
    if (!window.confirm(`Delete kit “${kit.name}”?`)) return
    setBusy(true)
    try {
      await apiFetch(`/kits/${kit.id}`, { method: 'DELETE' })
      setNotice(`Deleted kit “${kit.name}”.`)
      if (selectedId === kit.id) setSelectedId(null)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  function addKitToPlanner(kit: PrintKit) {
    const copies = Number(kitCopies)
    if (!Number.isInteger(copies) || copies < 1) {
      setError('Kit copies must be a positive whole number.')
      return
    }
    setError(null)
    const filesById = new Map(files.map((f) => [f.id, f]))
    const added: PlannerSessionItem[] = []
    for (let run = 0; run < copies; run++) {
      for (const line of kit.items) {
        const file = filesById.get(line.gcode_file_id)
        for (let q = 0; q < line.quantity; q++) {
          added.push(
            resolveSessionItemColor(
              {
                sessionId: newSessionId(),
                gcodeFileId: line.gcode_file_id,
                originalFilename: line.gcode_filename,
                displayName: line.gcode_display_name || line.gcode_filename,
                printTimeSeconds: file?.print_time_seconds ?? null,
                priority: 0,
                materialPresetId: line.material_preset_id,
                materialPresetName: line.material_preset_name,
                materialColorPresetId: line.material_color_preset_id,
                materialColorPresetName: line.material_color_preset_name,
                matchAnyMaterial: false,
                matchAnyColor: false,
                printKitId: kit.id,
                kitRunIndex: run,
                copyLabel: `${run + 1}.${q + 1}`,
              },
            ),
          )
        }
      }
    }
    appendPlannerImport(added)
    setNotice(`Added ${added.length} job${added.length === 1 ? '' : 's'} to the planner session.`)
    navigate('/planner')
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Print kits</h1>
          <p className="muted">
            Named collections of G-code files with material and quantity. Create kits here, then send copies to
            the <Link to="/planner">planner</Link>.
          </p>
        </div>
        {isManager ? (
          <button type="button" className="btn primary" disabled={busy || files.length === 0} onClick={startNew}>
            New kit
          </button>
        ) : null}
      </div>

      {files.length === 0 ? (
        <p className="muted">
          Upload G-code to the <Link to="/library">print library</Link> before creating kits.
        </p>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
      {notice ? (
        <p className="success subtle">
          {notice}
          {isManager ? (
            <>
              {' '}
              <Link to="/planner">Go to planner →</Link>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="kits-layout">
        <aside className="card kits-list-panel">
          <h2>Kits</h2>
          {!kits ? <p>Loading…</p> : null}
          {kits && kits.length === 0 ? <p className="muted">No kits yet.</p> : null}
          <ul className="kits-list">
            {kits?.map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  className={`kits-list-btn${selectedId === k.id && !editing ? ' active' : ''}`}
                  onClick={() => {
                    setEditing(false)
                    setSelectedId(k.id)
                  }}
                >
                  {k.name}
                  <span className="muted small">{k.items.length} file{k.items.length === 1 ? '' : 's'}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="kits-main">
          {editing ? (
            <section className="card">
              <h2>{selectedId ? 'Edit kit' : 'New kit'}</h2>
              <form onSubmit={(e) => void saveKit(e)}>
                <label>
                  Name
                  <input value={name} maxLength={128} required disabled={busy} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  Description (optional)
                  <input
                    value={description}
                    maxLength={512}
                    disabled={busy}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
                <h3>Files</h3>
                <table className="table">
                  <thead>
                    <tr>
                      <th>G-code</th>
                      <th>Material</th>
                      <th>Color</th>
                      <th>Qty</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {itemRows.map((row, idx) => (
                      <tr key={row.key}>
                        <td>
                          <select
                            value={row.gcode_file_id}
                            disabled={busy}
                            onChange={(e) => {
                              const gcode_file_id = Number(e.target.value)
                              const gf = files.find((f) => f.id === gcode_file_id)
                              setItemRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx
                                    ? {
                                        ...r,
                                        gcode_file_id,
                                        material_preset_id:
                                          gf?.material_preset_id ?? r.material_preset_id,
                                        material_color_preset_id: gf?.material_color_preset_id ?? null,
                                      }
                                    : r,
                                ),
                              )
                            }}
                          >
                            {files.map((f) => (
                              <option key={f.id} value={f.id}>
                                {gcodeFileLabel(f)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={row.material_preset_id}
                            disabled={busy}
                            onChange={(e) => {
                              const material_preset_id = Number(e.target.value)
                              setItemRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx
                                    ? { ...r, material_preset_id, material_color_preset_id: null }
                                    : r,
                                ),
                              )
                            }}
                          >
                            {materials.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={row.material_color_preset_id ?? ''}
                            disabled={busy}
                            onChange={(e) => {
                              const v = e.target.value
                              setItemRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx
                                    ? {
                                        ...r,
                                        material_color_preset_id: v ? Number(v) : null,
                                      }
                                    : r,
                                ),
                              )
                            }}
                          >
                            <option value="">—</option>
                            {(
                              materials.find((m) => m.id === row.material_preset_id)?.color_presets ?? []
                            ).map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            min={1}
                            value={row.quantity}
                            disabled={busy}
                            onChange={(e) => {
                              const quantity = Number(e.target.value)
                              setItemRows((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, quantity } : r)),
                              )
                            }}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn sm secondary"
                            disabled={busy || itemRows.length <= 1}
                            onClick={() => setItemRows((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  type="button"
                  className="btn sm secondary"
                  disabled={busy}
                  onClick={() => setItemRows((prev) => [...prev, newItemRow(files, materials)])}
                >
                  Add file
                </button>
                <div className="btn-row">
                  <button type="button" className="btn secondary" disabled={busy} onClick={cancelEdit}>
                    Cancel
                  </button>
                  <button type="submit" className="btn primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save kit'}
                  </button>
                </div>
              </form>
            </section>
          ) : selected ? (
            <section className="card">
              <h2>{selected.name}</h2>
              {selected.description ? <p className="muted">{selected.description}</p> : null}
              <table className="table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Material</th>
                    <th>Color</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((i) => (
                    <tr key={i.id}>
                      <td title={i.gcode_filename}>{i.gcode_display_name || i.gcode_filename}</td>
                      <td>{i.material_preset_name}</td>
                      <td className="muted">{i.material_color_preset_name ?? '—'}</td>
                      <td>{i.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {isManager ? (
                <div className="kits-actions">
                  <button type="button" className="btn secondary" disabled={busy} onClick={() => startEdit(selected)}>
                    Edit
                  </button>
                  <button type="button" className="btn secondary danger" disabled={busy} onClick={() => void deleteKit(selected)}>
                    Delete
                  </button>
                  <label className="kits-copies-field">
                    Kit copies
                    <input
                      type="number"
                      min={1}
                      value={kitCopies}
                      disabled={busy}
                      onChange={(e) => setKitCopies(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() => void addKitToPlanner(selected)}
                  >
                    Add to planner
                  </button>
                </div>
              ) : null}
            </section>
          ) : (
            <p className="muted">Select a kit or create a new one.</p>
          )}
        </div>
      </div>
    </div>
  )
}
