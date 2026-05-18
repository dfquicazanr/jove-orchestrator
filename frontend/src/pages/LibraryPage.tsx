import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { GcodeLibraryPanel } from '../components/GcodeLibraryPanel'
import type { MaterialPreheatPreset } from '../types/materialPreheat'
import { MOCK_PREHEAT_PRESETS } from '../types/materialPreheat'

export function LibraryPage() {
  const { me } = useAuth()
  const isManager = me?.role === 'manager'
  const [materialPresets, setMaterialPresets] = useState<MaterialPreheatPreset[]>([])

  const loadMaterialPresets = useCallback(async () => {
    try {
      const data = await apiFetch<MaterialPreheatPreset[]>('/settings/material-preheat')
      setMaterialPresets(data)
    } catch {
      setMaterialPresets(MOCK_PREHEAT_PRESETS)
    }
  }, [])

  useEffect(() => {
    void loadMaterialPresets()
  }, [loadMaterialPresets])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Print library</h1>
          <p className="muted">
            Upload and manage G-code files. Add jobs to the planner from here or from print kits.
          </p>
        </div>
      </div>

      {!isManager ? (
        <p className="muted">You are signed in as a viewer. Uploading files requires a manager account.</p>
      ) : null}

      <GcodeLibraryPanel
        isManager={isManager}
        materialPresets={materialPresets}
        materialsHref="/materials"
        onQueueChanged={() => {}}
      />
    </div>
  )
}
