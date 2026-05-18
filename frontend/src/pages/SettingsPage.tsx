import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { apiFetch } from '../api/client'
import { HomeAssistantSettingsPanel } from '../components/HomeAssistantSettingsPanel'

type UserRow = {
  id: number
  username: string
  role: string
  is_active: boolean
  created_at: string
}

export function SettingsPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'manager' | 'viewer'>('viewer')
  const [busy, setBusy] = useState(false)

  const loadUsers = useCallback(async () => {
    setError(null)
    try {
      const data = await apiFetch<UserRow[]>('/users')
      setUsers(data)
    } catch (e) {
      setUsers(null)
      setError(e instanceof Error ? e.message : 'Failed to load users')
    }
  }, [])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  async function createUser(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const createdName = newUsername.trim()
      await apiFetch<UserRow>('/users', {
        method: 'POST',
        json: { username: createdName, password: newPassword, role: newRole },
      })
      setNewUsername('')
      setNewPassword('')
      setNotice(`User “${createdName}” created.`)
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create user failed')
    } finally {
      setBusy(false)
    }
  }

  async function deactivateUser(user: UserRow) {
    if (!window.confirm(`Deactivate “${user.username}”? They will not be able to sign in.`)) return
    setBusy(true)
    setError(null)
    try {
      await apiFetch(`/users/${user.id}/deactivate`, { method: 'PATCH' })
      setNotice(`Deactivated ${user.username}.`)
      await loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deactivate failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Platform configuration: users and Home Assistant integration.</p>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success subtle">{notice}</p> : null}

      <section className="card settings-section">
        <h2>Home Assistant</h2>
        <p className="muted small">
          Powers hardware on/off for printers with a linked entity. Link entities per printer from Farm →
          Edit.
        </p>
        <HomeAssistantSettingsPanel />
      </section>

      <section className="card settings-section">
        <h2>Users</h2>
        <p className="muted small">
          Managers can change the farm, library, kits, and planner. Viewers can browse Farm, library, and kits
          only.
        </p>

        {!users ? <p>Loading…</p> : null}
        {users && users.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{u.role}</td>
                  <td>{u.is_active ? 'Yes' : 'No'}</td>
                  <td>
                    {u.is_active ? (
                      <button
                        type="button"
                        className="btn sm secondary"
                        disabled={busy}
                        onClick={() => void deactivateUser(u)}
                      >
                        Deactivate
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <form className="settings-user-form" onSubmit={(e) => void createUser(e)}>
          <h3>Add user</h3>
          <div className="settings-user-fields">
            <label>
              Username
              <input
                type="text"
                value={newUsername}
                required
                maxLength={64}
                disabled={busy}
                onChange={(e) => setNewUsername(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={newPassword}
                required
                minLength={8}
                disabled={busy}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </label>
            <label>
              Role
              <select value={newRole} disabled={busy} onChange={(e) => setNewRole(e.target.value as 'manager' | 'viewer')}>
                <option value="viewer">Viewer</option>
                <option value="manager">Manager</option>
              </select>
            </label>
          </div>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create user'}
          </button>
        </form>
      </section>
    </div>
  )
}
