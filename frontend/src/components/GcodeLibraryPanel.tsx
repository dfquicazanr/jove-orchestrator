import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { formatFilamentGrams, formatFilamentMeters, formatPrintTime } from '../lib/formatGcodeMeta'
import {
  densityForMaterialPreset,
  filamentMetadataWarnings,
  reconcileFilament,
  type FilamentMetadataWarning,
} from '../lib/filamentEstimate'
import { parseGcodeFilePreview, type GcodeMetadataPreview } from '../lib/parseGcodeMetadata'
import { defaultGcodeDisplayName, gcodeFileLabel, gcodeMaterialColorLabel } from '../lib/gcodeLabels'
import { uploadGcodeFile } from '../lib/gcodeUpload'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import type { GCodeFile } from '../types/gcode'
import { ColorPresetSelect } from './ColorPresetSelect'
import { GcodeAddToQueueModal } from './GcodeAddToQueueModal'
import { GcodeParseDebugAccordion } from './GcodeParseDebugAccordion'
import { GcodeLibraryDetailView, GcodeLibraryEditPanel } from './GcodeLibraryEditPanel'

type PendingRow = {
  id: string
  file: File
  displayName: string
  materialPresetId: string
  colorPresetId: string
  preview: GcodeMetadataPreview | null
  previewLoading: boolean
}

function emptyPreview(): GcodeMetadataPreview {
  return {
    filament_mass_grams: null,
    filament_length_mm: null,
    print_time_seconds: null,
    parseMatches: [],
  }
}

function pendingFilamentPreview(
  row: PendingRow,
  materialPresets: MaterialPreheatPreset[],
): {
  massGrams: number | null
  lengthMm: number | null
  massWarnings: FilamentMetadataWarning[]
  lengthWarnings: FilamentMetadataWarning[]
} {
  const raw = row.preview
  const density = densityForMaterialPreset(materialPresets, row.materialPresetId)
  const reconciled = reconcileFilament(
    raw?.filament_mass_grams,
    raw?.filament_length_mm,
    density,
  )
  const warnings = filamentMetadataWarnings(raw, reconciled)
  return {
    massGrams: reconciled.massGrams,
    lengthMm: reconciled.lengthMm,
    massWarnings: warnings.filter((w) => w.id === 'missing-mass' || w.id === 'mass-from-density'),
    lengthWarnings: warnings.filter((w) => w.id === 'missing-length' || w.id === 'length-from-density'),
  }
}

function libraryMassWarnings(file: GCodeFile): FilamentMetadataWarning[] {
  if (file.filament_mass_grams_estimate != null) return []
  return [
    {
      id: 'missing-mass',
      message: 'Weight missing',
      detail: 'Set material density or re-upload with slicer metadata',
    },
  ]
}

function libraryLengthWarnings(file: GCodeFile): FilamentMetadataWarning[] {
  if (file.filament_length_mm != null) return []
  return [
    {
      id: 'missing-length',
      message: 'Length missing',
      detail: 'Set material density or re-upload with slicer metadata',
    },
  ]
}

type Props = {
  isManager: boolean
  materialsHref?: string
  onQueueChanged: () => void
  materialPresets: MaterialPreheatPreset[]
}

export function GcodeLibraryPanel({
  isManager,
  materialsHref = '/materials',
  onQueueChanged,
  materialPresets,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<GCodeFile[] | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [rows, setRows] = useState<PendingRow[]>([])
  const [defaultPresetId, setDefaultPresetId] = useState('')
  const [defaultColorPresetId, setDefaultColorPresetId] = useState('')
  const [editingFile, setEditingFile] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [addQueueFile, setAddQueueFile] = useState<GCodeFile | null>(null)

  const loadFiles = useCallback(async () => {
    setError(null)
    try {
      const data = await apiFetch<GCodeFile[]>('/gcode/files')
      setFiles(data)
      setSelectedId((prev) => {
        if (prev != null && data.some((f) => f.id === prev)) return prev
        return data[0]?.id ?? null
      })
    } catch (e) {
      setFiles(null)
      setError(e instanceof Error ? e.message : 'Failed to load G-code library')
    }
  }, [])

  useEffect(() => {
    void loadFiles()
  }, [loadFiles])

  useEffect(() => {
    if (materialPresets.length === 0) {
      setDefaultPresetId('')
      return
    }
    setDefaultPresetId((prev) => {
      if (prev && materialPresets.some((p) => String(p.id) === prev)) return prev
      return ''
    })
  }, [materialPresets])

  const selected = files?.find((f) => f.id === selectedId) ?? null

  function addFiles(fileList: FileList | File[]) {
    const list = Array.from(fileList).filter((f) => f.size > 0)
    if (list.length === 0) return
    const defaults = {
      materialPresetId: defaultPresetId,
      colorPresetId: defaultColorPresetId,
    }
    const added = list.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      displayName: defaultGcodeDisplayName(f.name),
      materialPresetId: defaults.materialPresetId,
      colorPresetId: defaults.colorPresetId,
      preview: null,
      previewLoading: true,
    }))
    setRows((prev) => {
      const existing = new Set(prev.map((r) => `${r.file.name}:${r.file.size}:${r.file.lastModified}`))
      const fresh = added.filter((r) => !existing.has(`${r.file.name}:${r.file.size}:${r.file.lastModified}`))
      return fresh.length ? [...prev, ...fresh] : prev
    })
    setError(null)
    setNotice(null)

    for (const row of added) {
      void parseGcodeFilePreview(row.file)
        .then((preview) => {
          setRows((prev) =>
            prev.map((r) => (r.id === row.id ? { ...r, preview, previewLoading: false } : r)),
          )
        })
        .catch(() => {
          setRows((prev) =>
            prev.map((r) =>
              r.id === row.id ? { ...r, preview: emptyPreview(), previewLoading: false } : r,
            ),
          )
        })
    }
  }

  async function onUploadSubmit(e: FormEvent) {
    e.preventDefault()
    if (rows.length === 0) {
      setError('Add at least one G-code file.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    let okCount = 0
    const failed: string[] = []
    const failedIds = new Set<string>()

    try {
      for (const row of rows) {
        const presetId = row.materialPresetId ? Number(row.materialPresetId) : null
        const colorId = row.colorPresetId ? Number(row.colorPresetId) : null
        const preset = presetId != null ? materialPresets.find((p) => p.id === presetId) : null
        try {
          await uploadGcodeFile(row.file, {
            enqueue: false,
            display_name: row.displayName.trim() || defaultGcodeDisplayName(row.file.name),
            material_preset_id: presetId,
            material_color_preset_id: colorId,
            required_material: preset?.name ?? null,
            required_color: null,
          })
          okCount += 1
        } catch (err) {
          failedIds.add(row.id)
          failed.push(`${row.file.name}: ${err instanceof Error ? err.message : 'Upload failed'}`)
        }
      }

      if (okCount > 0) {
        await loadFiles()
      }

      if (failed.length === 0) {
        setRows([])
        if (fileInputRef.current) fileInputRef.current.value = ''
        setNotice(`Saved ${okCount} file${okCount === 1 ? '' : 's'} to the library.`)
      } else if (okCount > 0) {
        setRows((prev) => prev.filter((r) => failedIds.has(r.id)))
        setNotice(`Saved ${okCount} file(s); ${failed.length} failed.`)
        setError(failed.join(' · '))
      } else {
        setError(failed.join(' · '))
      }
    } finally {
      setBusy(false)
    }
  }

  async function deleteFile(file: GCodeFile) {
    if (!window.confirm(`Delete “${file.original_filename}” from the library? Queue rows for this file are removed too.`)) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/gcode/files/${file.id}`, { method: 'DELETE' })
      setNotice(`Deleted ${file.original_filename}.`)
      await loadFiles()
      onQueueChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card gcode-library-panel">
      <LibraryHeader isManager={isManager} materialsHref={materialsHref} />

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success subtle">{notice}</p> : null}

      {isManager ? (
        <form className="gcode-library-upload" onSubmit={(e) => void onUploadSubmit(e)}>
          <p className="muted small">
            Upload saves files to the library only. Filament and print time are read from slicer comments
            (Cura, Creality Print, PrusaSlicer, etc.). If weight or length is missing, you will see a warning;
            assign a material with a default density on{' '}
            <Link to={materialsHref}>Materials</Link> to estimate the missing value.
          </p>
          <ColorPresetSelect
            materialPresets={materialPresets}
            materialPresetId={defaultPresetId}
            value={defaultColorPresetId}
            disabled={busy}
            allowEmptyMaterial
            materialLabel="Default material (optional)"
            colorLabel="Default color (optional)"
            onMaterialPresetIdChange={(id) => {
              setDefaultPresetId(id)
              setDefaultColorPresetId('')
            }}
            onColorPresetIdChange={setDefaultColorPresetId}
          />
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
            <button type="button" className="btn secondary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
              Add G-code files…
            </button>
            {rows.length > 0 ? (
              <button type="button" className="btn sm secondary" disabled={busy} onClick={() => setRows([])}>
                Clear pending
              </button>
            ) : null}
          </div>
          {rows.length > 0 ? (
            <div className="queue-upload-table-wrap">
              <table className="table queue-upload-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Weight (est.)</th>
                    <th>Length (est.)</th>
                    <th>Print time</th>
                    <th>Material</th>
                    <th>Color</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <Fragment key={row.id}>
                    <tr>
                      <td>
                        <input
                          className="queue-upload-meta"
                          value={row.displayName}
                          maxLength={256}
                          disabled={busy}
                          title={row.file.name}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r) => (r.id === row.id ? { ...r, displayName: e.target.value } : r)),
                            )
                          }
                        />
                      </td>
                      <td className="gcode-filament-metric-cell">
                        {row.previewLoading ? (
                          <span className="muted small">…</span>
                        ) : (
                          <PendingFilamentMetric
                            row={row}
                            materialPresets={materialPresets}
                            kind="mass"
                          />
                        )}
                      </td>
                      <td className="gcode-filament-metric-cell">
                        {row.previewLoading ? (
                          <span className="muted small">…</span>
                        ) : (
                          <PendingFilamentMetric
                            row={row}
                            materialPresets={materialPresets}
                            kind="length"
                          />
                        )}
                      </td>
                      <td className="gcode-preview-cell">
                        {row.previewLoading ? '…' : formatPrintTime(row.preview?.print_time_seconds ?? null)}
                      </td>
                      <td>
                        <select
                          className="queue-upload-meta"
                          value={row.materialPresetId}
                          disabled={busy}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r) =>
                                r.id === row.id
                                  ? { ...r, materialPresetId: e.target.value, colorPresetId: '' }
                                  : r,
                              ),
                            )
                          }
                        >
                          <option value="">— None —</option>
                          {materialPresets.map((p) => (
                            <option key={p.id} value={String(p.id)}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="queue-upload-meta"
                          value={row.colorPresetId}
                          disabled={busy || !row.materialPresetId}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev.map((r) => (r.id === row.id ? { ...r, colorPresetId: e.target.value } : r)),
                            )
                          }
                        >
                          <option value="">—</option>
                          {(materialPresets.find((p) => String(p.id) === row.materialPresetId)?.color_presets ?? []).map(
                            (c) => (
                              <option key={c.id} value={String(c.id)}>
                                {c.name}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td>
                        <button type="button" className="btn sm secondary" disabled={busy} onClick={() => setRows((p) => p.filter((r) => r.id !== row.id))}                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                    <tr className="gcode-upload-debug-row">
                      <td colSpan={7}>
                        <GcodeParseDebugAccordion
                          preview={row.preview}
                          loading={row.previewLoading}
                          densityGcm3={densityForMaterialPreset(materialPresets, row.materialPresetId)}
                          materialLabel={
                            materialPresets.find((p) => String(p.id) === row.materialPresetId)?.name
                          }
                        />
                      </td>
                    </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="btn-row">
            <button type="submit" className="btn primary" disabled={busy || rows.length === 0}>
              {busy ? 'Uploading…' : rows.length === 0 ? 'Upload to library' : `Upload ${rows.length} to library`}
            </button>
          </div>
        </form>
      ) : (
        <p className="muted small">Viewers can browse the library; uploads require a manager account.</p>
      )}

      <div className="gcode-library-main">
        {!files ? <p>Loading library…</p> : null}
        {files && files.length === 0 && rows.length === 0 ? (
          <p className="muted">No G-code files in the library yet. Managers can upload above.</p>
        ) : null}
        {files && files.length > 0 ? (
          <>
            <div className="gcode-library-list-wrap">
              <table
                className={`table gcode-library-table${isManager ? '' : ' gcode-library-table--viewer'}`}
              >
                <colgroup>
                  <col className="gcode-library-col-file" />
                  <col className="gcode-library-col-material" />
                  <col className="gcode-library-col-metric" />
                  <col className="gcode-library-col-metric" />
                  <col className="gcode-library-col-time" />
                  <col className="gcode-library-col-jobs" />
                  {isManager ? <col className="gcode-library-col-actions" /> : null}
                </colgroup>
                <thead>
                  <tr>
                    <th className="gcode-library-col-file">File</th>
                    <th className="gcode-library-col-material">Material</th>
                    <th className="gcode-library-col-metric">Weight</th>
                    <th className="gcode-library-col-metric">Length</th>
                    <th className="gcode-library-col-time">Print time</th>
                    <th className="gcode-library-col-jobs">Jobs</th>
                    {isManager ? <th className="gcode-library-col-actions">Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr
                      key={f.id}
                      className={f.id === selectedId ? 'gcode-library-row-selected' : undefined}
                      onClick={() => {
                        setSelectedId(f.id)
                        setEditingFile(false)
                      }}
                    >
                      <td className="gcode-library-col-file gcode-library-filename">
                        <span className="gcode-library-filename-primary" title={f.original_filename}>
                          {gcodeFileLabel(f)}
                        </span>
                        {f.display_name !== f.original_filename ? (
                          <span className="muted small gcode-library-filename-sub">{f.original_filename}</span>
                        ) : null}
                      </td>
                      <td className="gcode-library-col-material muted">{gcodeMaterialColorLabel(f)}</td>
                      <td className="gcode-library-col-metric gcode-filament-metric-cell">
                        <FilamentMetricDisplay
                          value={formatFilamentGrams(f.filament_mass_grams_estimate)}
                          warnings={libraryMassWarnings(f)}
                        />
                      </td>
                      <td className="gcode-library-col-metric gcode-filament-metric-cell">
                        <FilamentMetricDisplay
                          value={formatFilamentMeters(f.filament_length_mm)}
                          warnings={libraryLengthWarnings(f)}
                        />
                      </td>
                      <td className="gcode-library-col-time">{formatPrintTime(f.print_time_seconds)}</td>
                      <td className="gcode-library-col-jobs">{f.queue_item_count}</td>
                      {isManager ? (
                        <td className="gcode-library-col-actions" onClick={(e) => e.stopPropagation()}>
                          <div className="gcode-library-row-actions">
                            <button
                              type="button"
                              className="btn sm secondary"
                              disabled={busy}
                              onClick={() => setAddQueueFile(f)}
                            >
                              Queue
                            </button>
                            <button
                              type="button"
                              className="btn sm secondary"
                              disabled={busy}
                              onClick={() => void deleteFile(f)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selected ? (
              <aside className="gcode-library-detail card">
                {isManager && editingFile ? (
                  <GcodeLibraryEditPanel
                    file={selected}
                    materialPresets={materialPresets}
                    busy={busy}
                    onCancel={() => setEditingFile(false)}
                    onSaved={(saved) => {
                      setEditingFile(false)
                      setNotice(`Updated “${saved.display_name}”. Kit lines using this file were updated too.`)
                      void loadFiles()
                    }}
                  />
                ) : (
                  <GcodeLibraryDetailView
                    file={selected}
                    busy={busy}
                    onEdit={() => isManager && setEditingFile(true)}
                    onAddQueue={() => setAddQueueFile(selected)}
                    onDelete={() => void deleteFile(selected)}
                  />
                )}
              </aside>
            ) : null}
          </>
        ) : null}
      </div>

      <GcodeAddToQueueModal
        file={addQueueFile}
        open={addQueueFile != null}
        onClose={() => setAddQueueFile(null)}
        onAdded={async () => {
          setNotice(`Added draft job(s) for ${addQueueFile ? gcodeFileLabel(addQueueFile) : 'file'}.`)
          await loadFiles()
          onQueueChanged()
        }}
      />
    </section>
  )
}

function FilamentMetricDisplay({
  value,
  warnings,
}: {
  value: string
  warnings: FilamentMetadataWarning[]
}) {
  const hardWarnings = warnings.filter((w) => w.id.startsWith('missing-'))
  const info = warnings.filter((w) => !w.id.startsWith('missing-'))

  return (
    <div className="gcode-filament-metric">
      <span className="gcode-filament-metric-value">{value}</span>
      {hardWarnings.length > 0 ? (
        <ul className="gcode-metadata-warnings gcode-metadata-warnings--alert">
          {hardWarnings.map((w) => (
            <li key={w.id} title={w.detail}>
              {w.message}
            </li>
          ))}
        </ul>
      ) : null}
      {info.length > 0 ? (
        <ul className="gcode-metadata-warnings">
          {info.map((w) => (
            <li key={w.id} title={w.detail}>
              {w.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function PendingFilamentMetric({
  row,
  materialPresets,
  kind,
}: {
  row: PendingRow
  materialPresets: MaterialPreheatPreset[]
  kind: 'mass' | 'length'
}) {
  const { massGrams, lengthMm, massWarnings, lengthWarnings } = pendingFilamentPreview(row, materialPresets)
  const value = kind === 'mass' ? formatFilamentGrams(massGrams) : formatFilamentMeters(lengthMm)
  const warnings = kind === 'mass' ? massWarnings : lengthWarnings
  return <FilamentMetricDisplay value={value} warnings={warnings} />
}

function LibraryHeader({
  isManager,
  materialsHref,
}: {
  isManager: boolean
  materialsHref: string
}) {
  return (
    <div className="gcode-library-head">
      <div>
        <h2>G-code library</h2>
        <p className="muted small">Store prints here, then enqueue copies when you are ready.</p>
      </div>
      {isManager ? (
        <Link to={materialsHref} className="btn sm ghost">
          Materials
        </Link>
      ) : null}
    </div>
  )
}


