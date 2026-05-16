import { useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../api/client'

export type HomeAssistantSettingsView = {
  base_url: string | null
  token_configured: boolean
  effective_configured: boolean
  credentials_source: 'database' | 'environment' | null
}

type Props = {
  open: boolean
  onClose: () => void
  onSaved?: (s: HomeAssistantSettingsView) => void
}

function sourceHint(credentials_source: HomeAssistantSettingsView['credentials_source']): string | null {
  if (!credentials_source) return null
  if (credentials_source === 'environment') {
    return 'Active credentials come from HOME_ASSISTANT_* on the API server. Saving a complete URL + token here stores them in the database and overrides the environment.'
  }
  return 'Power actions use credentials stored in the Jove database (with environment as fallback only if the database pair is incomplete).'
}

export function HomeAssistantSettingsModal({ open, onClose, onSaved }: Props) {
  const [baseUrl, setBaseUrl] = useState('')
  const [newToken, setNewToken] = useState('')
  const [tokenFieldUnlocked, setTokenFieldUnlocked] = useState(false)
  const [loaded, setLoaded] = useState<HomeAssistantSettingsView | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyTest, setBusyTest] = useState(false)
  const [revokeStoredToken, setRevokeStoredToken] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setNotice(null)
    setNewToken('')
    setRevokeStoredToken(false)
    setTokenFieldUnlocked(false)
    void (async () => {
      try {
        const s = await apiFetch<HomeAssistantSettingsView>('/settings/home-assistant')
        setLoaded(s)
        setBaseUrl(s.base_url ?? '')
      } catch (e) {
        setLoaded(null)
        setError(e instanceof Error ? e.message : 'Failed to load Home Assistant settings')
      }
    })()
  }, [open])

  if (!open) return null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)

    type PutBody = { base_url?: string | null; token?: string; revoke_token?: boolean }
    const body: PutBody = { base_url: baseUrl.trim() || null }

    const tokenTrim = newToken.trim()
    if (tokenTrim) {
      body.token = tokenTrim
    } else if (revokeStoredToken) {
      body.revoke_token = true
    }

    setBusy(true)
    try {
      const saved = await apiFetch<HomeAssistantSettingsView>('/settings/home-assistant', {
        method: 'PUT',
        json: body,
      })
      setLoaded(saved)
      setBaseUrl(saved.base_url ?? '')
      setNewToken('')
      setRevokeStoredToken(false)
      setTokenFieldUnlocked(false)
      const msgParts: string[] = ['Home Assistant settings saved.']
      if (body.revoke_token) msgParts.push('Stored token cleared.')
      if (saved.effective_configured) msgParts.push('Farm power controls are ready.')
      else msgParts.push('Add URL + token (or rely on env) to enable power controls.')
      setNotice(msgParts.join(' '))
      onSaved?.(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function runTest() {
    setBusyTest(true)
    setError(null)
    setNotice(null)
    try {
      const overrides: Record<string, string> = {}
      const u = baseUrl.trim()
      const t = newToken.trim()
      if (u) overrides.base_url = u
      if (t) overrides.token = t

      const r = await apiFetch<{ ok: boolean; message?: string | null }>(
        '/settings/home-assistant/test',
        { method: 'POST', json: overrides },
      )
      if (r.ok) {
        setNotice('Home Assistant reachable — Bearer token accepted.')
      } else {
        setError(r.message ?? 'Could not reach Home Assistant')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed')
    } finally {
      setBusyTest(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="ha-settings-title">
        <div className="modal-head">
          <h2 id="ha-settings-title">Home Assistant</h2>
          <button type="button" className="linkish" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </div>
        <form className="modal-body ha-settings-body" onSubmit={onSubmit}>
          <p className="muted small">
            Long-lived token from your HA profile powers <strong>Farm · Controls · Power On/Off</strong> when
            each printer has an entity id configured (printer connection dialog). Works with plugs, relays, and{' '}
            <code className="inline-code">switch.*</code> / <code className="inline-code">input_boolean.*</code>{' '}
            entities.
          </p>
          {loaded?.credentials_source ? (
            <p className="muted small">{sourceHint(loaded.credentials_source)}</p>
          ) : null}

          <label className="ha-settings-label">
            Base URL
            <input
              type="url"
              autoComplete="off"
              placeholder="http://homeassistant.local:8123"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className="ha-settings-label">
            Long-lived access token
            <input
              type="password"
              autoComplete="off"
              readOnly={!tokenFieldUnlocked && !newToken.length}
              onFocus={() => setTokenFieldUnlocked(true)}
              placeholder={loaded?.token_configured ? '•••••••• (leave blank to keep)' : 'Paste token'}
              value={newToken}
              onChange={(e) => {
                setNewToken(e.target.value)
                if (e.target.value.trim()) setRevokeStoredToken(false)
              }}
              disabled={busy}
            />
          </label>
          <p className="muted small">
            Create one under Home Assistant → Profile → Long-Lived Access Tokens. Never share it outside this
            form. If a password manager shows dots but Jove still says the token is missing, click in this
            field once so the value is applied, then Test or Save.
          </p>

          <p className="muted small">
            <strong>Test connection</strong> uses the URL and token you typed above when present, and takes any
            missing value from <strong>saved</strong> settings or the API server environment — you can test
            before Save.
          </p>

          {loaded?.token_configured ? (
            <label className="checkbox ha-settings-revoke">
              <input
                type="checkbox"
                checked={revokeStoredToken}
                onChange={(e) => setRevokeStoredToken(e.target.checked)}
                disabled={busy}
              />
              Remove saved token from Jove
            </label>
          ) : null}

          {loaded ? (
            <p className="muted small">
              Status:{' '}
              {loaded.effective_configured ? (
                <span className="success subtle">connected (power API ready)</span>
              ) : (
                <span>not fully configured</span>
              )}
              {loaded.token_configured ? (
                <> · token stored in Jove</>
              ) : (
                <> · no token in Jove yet</>
              )}
            </p>
          ) : null}

          {error ? <p className="error">{error}</p> : null}
          {notice ? <p className="success subtle">{notice}</p> : null}

          <div className="ha-settings-actions">
            <button type="button" className="btn secondary" disabled={busy || busyTest} onClick={runTest}>
              {busyTest ? 'Testing…' : 'Test connection'}
            </button>
            <div className="ha-settings-actions-end">
              <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
