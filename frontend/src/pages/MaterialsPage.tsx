import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../api/client'
import { randomId } from '../lib/randomId'
import { useAuth } from '../auth/AuthContext'
import type { MaterialColorPreset, MaterialPreheatPreset } from '../types/materialPreheat'
import { MOCK_PREHEAT_PRESETS } from '../types/materialPreheat'

type MaterialRow = {
  key: string
  name: string
  hotend_c: string
  bed_c: string
  default_density_g_cm3: string
}

type ColorRow = {
  key: string
  name: string
  hex: string
  is_default: boolean
  notes: string
}

function toMaterialRows(presets: MaterialPreheatPreset[]): MaterialRow[] {
  return presets.map((p) => ({
    key: String(p.id),
    name: p.name,
    hotend_c: String(p.hotend_c),
    bed_c: String(p.bed_c),
    default_density_g_cm3:
      p.default_density_g_cm3 != null && p.default_density_g_cm3 > 0
        ? String(p.default_density_g_cm3)
        : '',
  }))
}

function toColorRows(colors: MaterialColorPreset[]): ColorRow[] {
  return colors.map((c) => ({
    key: String(c.id),
    name: c.name,
    hex: c.hex ?? '',
    is_default: c.is_default,
    notes: c.notes ?? '',
  }))
}

function buildColorMap(presets: MaterialPreheatPreset[]): Record<string, ColorRow[]> {
  const map: Record<string, ColorRow[]> = {}
  for (const p of presets) {
    map[String(p.id)] = toColorRows(p.color_presets ?? [])
  }
  return map
}

function newMaterialRow(): MaterialRow {
  return { key: `new-${randomId()}`, name: '', hotend_c: '200', bed_c: '60', default_density_g_cm3: '' }
}

function newColorRow(): ColorRow {
  return { key: `new-${randomId()}`, name: '', hex: '#808080', is_default: false, notes: '' }
}

function materialRowId(row: MaterialRow): number | null {
  const id = Number(row.key)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function MaterialsPage() {
  const { me } = useAuth()
  const isManager = me?.role === 'manager'

  const [materialRows, setMaterialRows] = useState<MaterialRow[]>([])
  const [colorRowsByMaterial, setColorRowsByMaterial] = useState<Record<string, ColorRow[]>>({})
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await apiFetch<MaterialPreheatPreset[]>('/settings/material-preheat')
      setMaterialRows(toMaterialRows(data))
      setColorRowsByMaterial(buildColorMap(data))
    } catch (e) {
      setMaterialRows(toMaterialRows(MOCK_PREHEAT_PRESETS))
      setColorRowsByMaterial(buildColorMap(MOCK_PREHEAT_PRESETS))
      setError(e instanceof Error ? e.message : 'Failed to load materials')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function toggleCollapsed(materialKey: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(materialKey)) next.delete(materialKey)
      else next.add(materialKey)
      return next
    })
  }

  function setColorsForMaterial(materialKey: string, updater: (prev: ColorRow[]) => ColorRow[]) {
    setColorRowsByMaterial((prev) => ({
      ...prev,
      [materialKey]: updater(prev[materialKey] ?? []),
    }))
  }

  async function saveMaterials(e: FormEvent) {
    e.preventDefault()
    if (!isManager) return
    setError(null)
    setNotice(null)

    const parsed: {
      id?: number
      name: string
      hotend_c: number
      bed_c: number
      default_density_g_cm3: number | null
      sort_order: number
    }[] = []
    for (let i = 0; i < materialRows.length; i++) {
      const row = materialRows[i]
      const name = row.name.trim()
      if (!name) {
        setError(`Material ${i + 1}: name is required.`)
        return
      }
      const hotend = Number(row.hotend_c)
      const bed = Number(row.bed_c)
      if (Number.isNaN(hotend) || hotend < 0 || hotend > 400) {
        setError(`Material ${i + 1}: hotend must be 0–400°C.`)
        return
      }
      if (Number.isNaN(bed) || bed < 0 || bed > 150) {
        setError(`Material ${i + 1}: bed must be 0–150°C.`)
        return
      }
      const densityRaw = row.default_density_g_cm3.trim()
      let default_density_g_cm3: number | null = null
      if (densityRaw !== '') {
        const density = Number(densityRaw)
        if (Number.isNaN(density) || density <= 0 || density > 10) {
          setError(`Material ${i + 1}: density must be between 0 and 10 g/cm³, or leave blank.`)
          return
        }
        default_density_g_cm3 = density
      }
      const id = materialRowId(row)
      parsed.push({
        ...(id != null ? { id } : {}),
        name,
        hotend_c: hotend,
        bed_c: bed,
        default_density_g_cm3,
        sort_order: i,
      })
    }
    if (parsed.length === 0) {
      setError('Add at least one material.')
      return
    }
    const names = parsed.map((p) => p.name.toLowerCase())
    if (new Set(names).size !== names.length) {
      setError('Each material name must be unique.')
      return
    }

    setBusy(true)
    try {
      const saved = await apiFetch<MaterialPreheatPreset[]>('/settings/material-preheat', {
        method: 'PUT',
        json: { presets: parsed },
      })
      setMaterialRows(toMaterialRows(saved))
      setColorRowsByMaterial(buildColorMap(saved))
      setNotice('Materials saved. You can add colors under each material below.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function saveColorsForMaterial(row: MaterialRow) {
    const materialId = materialRowId(row)
    if (!isManager || materialId == null) return
    const colors = colorRowsByMaterial[row.key] ?? []
    setError(null)
    setNotice(null)

    const parsed: {
      name: string
      hex: string | null
      is_default: boolean
      notes: string | null
      sort_order: number
    }[] = []
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i]
      const name = c.name.trim()
      if (!name) {
        setError(`${row.name || 'Material'}: color row ${i + 1} needs a name.`)
        return
      }
      parsed.push({
        name,
        hex: c.hex.trim() || null,
        is_default: c.is_default,
        notes: c.notes.trim() || null,
        sort_order: i,
      })
    }
    const colorNames = parsed.map((c) => c.name.toLowerCase())
    if (new Set(colorNames).size !== colorNames.length) {
      setError(`${row.name}: color names must be unique within this material.`)
      return
    }
    if (parsed.filter((c) => c.is_default).length > 1) {
      setError(`${row.name}: at most one default color.`)
      return
    }

    setBusy(true)
    try {
      await apiFetch<MaterialColorPreset[]>(`/settings/material-preheat/${materialId}/colors`, {
        method: 'PUT',
        json: { colors: parsed },
      })
      await load()
      setNotice(`Colors saved for ${row.name.trim() || 'material'}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save colors failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Materials</h1>
          <p className="muted">
            Each material has its own colors (PLA Red and ASA Red are separate). Set a default density
            (g/cm³) to estimate missing filament weight or length from Cura G-code. Typical PLA is about
            1.24.
          </p>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success subtle">{notice}</p> : null}

      {!isManager ? (
        <p className="muted">Viewers can browse materials. Editing requires a manager account.</p>
      ) : null}

      <section className="card materials-unified">
        <form onSubmit={(e) => void saveMaterials(e)}>
          <div className="materials-list">
            {materialRows.map((row, idx) => {
              const materialId = materialRowId(row)
              const colors = colorRowsByMaterial[row.key] ?? []
              const isOpen = !collapsed.has(row.key)
              const label = row.name.trim() || 'New material'

              return (
                <article key={row.key} className="material-block">
                  <div className="material-block-head">
                    <button
                      type="button"
                      className="material-block-toggle linkish"
                      aria-expanded={isOpen}
                      onClick={() => toggleCollapsed(row.key)}
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>
                    <div className="material-block-fields">
                      <label>
                        <span className="material-field-label">Material</span>
                        <input
                          type="text"
                          value={row.name}
                          disabled={!isManager || busy}
                          placeholder="PLA"
                          onChange={(e) => {
                            const name = e.target.value
                            setMaterialRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, name } : r)),
                            )
                          }}
                        />
                      </label>
                      <label>
                        <span className="material-field-label">Hotend (°C)</span>
                        <input
                          type="number"
                          min={0}
                          max={400}
                          value={row.hotend_c}
                          disabled={!isManager || busy}
                          onChange={(e) => {
                            const hotend_c = e.target.value
                            setMaterialRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, hotend_c } : r)),
                            )
                          }}
                        />
                      </label>
                      <label>
                        <span className="material-field-label">Bed (°C)</span>
                        <input
                          type="number"
                          min={0}
                          max={150}
                          value={row.bed_c}
                          disabled={!isManager || busy}
                          onChange={(e) => {
                            const bed_c = e.target.value
                            setMaterialRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, bed_c } : r)),
                            )
                          }}
                        />
                      </label>
                      <label>
                        <span className="material-field-label">Density (g/cm³)</span>
                        <input
                          type="number"
                          min={0.01}
                          max={10}
                          step={0.01}
                          placeholder="e.g. 1.24"
                          value={row.default_density_g_cm3}
                          disabled={!isManager || busy}
                          title="Used to estimate missing filament weight or length in the library"
                          onChange={(e) => {
                            const default_density_g_cm3 = e.target.value
                            setMaterialRows((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, default_density_g_cm3 } : r)),
                            )
                          }}
                        />
                      </label>
                    </div>
                    {isManager ? (
                      <button
                        type="button"
                        className="btn sm secondary material-block-remove"
                        disabled={busy || materialRows.length <= 1}
                        onClick={() => {
                          setMaterialRows((prev) => prev.filter((_, i) => i !== idx))
                          setColorRowsByMaterial((prev) => {
                            const next = { ...prev }
                            delete next[row.key]
                            return next
                          })
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>

                  {isOpen ? (
                    <div className="material-block-colors">
                      <p className="material-colors-heading muted small">
                        Colors for <strong>{label}</strong>
                        {colors.length > 0 ? ` (${colors.length})` : ''}
                      </p>

                      {colors.length === 0 && !isManager ? (
                        <p className="muted small">No colors defined.</p>
                      ) : null}

                      {(colors.length > 0 || isManager) && (
                        <div className="preheat-presets-table-wrap">
                          <table className="table preheat-presets-table material-colors-table">
                            <thead>
                              <tr>
                                <th>Color name</th>
                                <th>Swatch</th>
                                <th>Default</th>
                                <th>Notes</th>
                                {isManager ? <th /> : null}
                              </tr>
                            </thead>
                            <tbody>
                              {colors.length === 0 ? (
                                <tr>
                                  <td colSpan={isManager ? 5 : 4} className="muted">
                                    No colors yet — add one below.
                                  </td>
                                </tr>
                              ) : (
                                colors.map((colorRow, colorIdx) => (
                                  <tr key={colorRow.key}>
                                    <td>
                                      {isManager ? (
                                        <input
                                          type="text"
                                          value={colorRow.name}
                                          placeholder="Red"
                                          disabled={busy}
                                          onChange={(e) => {
                                            const name = e.target.value
                                            setColorsForMaterial(row.key, (prev) =>
                                              prev.map((r, i) => (i === colorIdx ? { ...r, name } : r)),
                                            )
                                          }}
                                        />
                                      ) : (
                                        <span className="material-color-swatch-label">
                                          {colorRow.hex && colorRow.hex.startsWith('#') ? (
                                            <span
                                              className="material-color-dot"
                                              style={{ background: colorRow.hex }}
                                              aria-hidden
                                            />
                                          ) : null}
                                          {colorRow.name}
                                        </span>
                                      )}
                                    </td>
                                    <td className="color-hex-cell">
                                      {isManager ? (
                                        <>
                                          <input
                                            type="color"
                                            value={colorRow.hex.startsWith('#') ? colorRow.hex : '#808080'}
                                            disabled={busy}
                                            onChange={(e) => {
                                              const hex = e.target.value
                                              setColorsForMaterial(row.key, (prev) =>
                                                prev.map((r, i) => (i === colorIdx ? { ...r, hex } : r)),
                                              )
                                            }}
                                          />
                                          <input
                                            type="text"
                                            value={colorRow.hex}
                                            maxLength={7}
                                            placeholder="#RRGGBB"
                                            disabled={busy}
                                            onChange={(e) => {
                                              const hex = e.target.value
                                              setColorsForMaterial(row.key, (prev) =>
                                                prev.map((r, i) => (i === colorIdx ? { ...r, hex } : r)),
                                              )
                                            }}
                                          />
                                        </>
                                      ) : (
                                        <span className="muted">{colorRow.hex || '—'}</span>
                                      )}
                                    </td>
                                    <td>
                                      {isManager ? (
                                        <input
                                          type="checkbox"
                                          checked={colorRow.is_default}
                                          disabled={busy}
                                          onChange={(e) => {
                                            const is_default = e.target.checked
                                            setColorsForMaterial(row.key, (prev) =>
                                              prev.map((r, i) => (i === colorIdx ? { ...r, is_default } : r)),
                                            )
                                          }}
                                        />
                                      ) : colorRow.is_default ? (
                                        'Yes'
                                      ) : (
                                        '—'
                                      )}
                                    </td>
                                    <td>
                                      {isManager ? (
                                        <input
                                          type="text"
                                          value={colorRow.notes}
                                          disabled={busy}
                                          onChange={(e) => {
                                            const notes = e.target.value
                                            setColorsForMaterial(row.key, (prev) =>
                                              prev.map((r, i) => (i === colorIdx ? { ...r, notes } : r)),
                                            )
                                          }}
                                        />
                                      ) : (
                                        <span className="muted">{colorRow.notes || '—'}</span>
                                      )}
                                    </td>
                                    {isManager ? (
                                      <td>
                                        <button
                                          type="button"
                                          className="btn sm secondary"
                                          disabled={busy}
                                          onClick={() =>
                                            setColorsForMaterial(row.key, (prev) =>
                                              prev.filter((_, i) => i !== colorIdx),
                                            )
                                          }
                                        >
                                          Remove
                                        </button>
                                      </td>
                                    ) : null}
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {isManager ? (
                        <div className="material-block-colors-actions">
                          {materialId != null ? (
                            <>
                              <button
                                type="button"
                                className="btn sm secondary"
                                disabled={busy}
                                onClick={() =>
                                  setColorsForMaterial(row.key, (prev) => [...prev, newColorRow()])
                                }
                              >
                                Add color
                              </button>
                              <button
                                type="button"
                                className="btn sm primary"
                                disabled={busy}
                                onClick={() => void saveColorsForMaterial(row)}
                              >
                                Save colors
                              </button>
                            </>
                          ) : (
                            <p className="muted small">
                              Save materials first (button below), then you can add colors for this entry.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="material-block-collapsed-summary muted small">
                      {colors.length === 0
                        ? 'No colors'
                        : colors.map((c) => c.name).filter(Boolean).join(', ') || `${colors.length} color(s)`}
                    </p>
                  )}
                </article>
              )
            })}
          </div>

          {isManager ? (
            <div className="materials-list-footer btn-row">
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => {
                  const row = newMaterialRow()
                  setMaterialRows((prev) => [...prev, row])
                  setColorRowsByMaterial((prev) => ({ ...prev, [row.key]: [] }))
                  setCollapsed((prev) => {
                    const next = new Set(prev)
                    next.delete(row.key)
                    return next
                  })
                }}
              >
                Add material
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save materials'}
              </button>
            </div>
          ) : null}
        </form>
      </section>
    </div>
  )
}
