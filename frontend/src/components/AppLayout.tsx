import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function AppLayout() {
  const { me, logout } = useAuth()
  const isManager = me?.role === 'manager'

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Jove</div>
        <nav className="topbar-nav">
          <NavLink to="/" end>
            Farm
          </NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/kits">Kits</NavLink>
          <NavLink to="/materials">Materials</NavLink>
          {isManager ? <NavLink to="/planner">Planner</NavLink> : null}
          {isManager ? <NavLink to="/settings">Settings</NavLink> : null}
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
