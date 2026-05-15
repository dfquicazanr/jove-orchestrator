import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function AppLayout() {
  const { me, logout } = useAuth()
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Jove</div>
        <nav>
          <NavLink to="/" end>
            Farm
          </NavLink>
          <NavLink to="/queue">Queue</NavLink>
        </nav>
        <div className="spacer" />
        <div className="user muted">
          {me?.username} · {me?.role}
        </div>
        <button type="button" className="linkish" onClick={logout}>
          Log out
        </button>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
