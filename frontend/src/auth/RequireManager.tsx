import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function RequireManager() {
  const { me, loading } = useAuth()
  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    )
  }
  if (!me) return <Navigate to="/login" replace />
  if (me.role !== 'manager') return <Navigate to="/" replace />
  return <Outlet />
}
