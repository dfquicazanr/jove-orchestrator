import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

type NavItem = {
  to: string
  label: string
  end?: boolean
  managerOnly?: boolean
}

const NAV_LINKS: NavItem[] = [
  { to: '/', end: true, label: 'Farm' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/library', label: 'Library' },
  { to: '/kits', label: 'Kits' },
  { to: '/materials', label: 'Materials' },
  { to: '/planner', label: 'Planner', managerOnly: true },
  { to: '/settings', label: 'Settings', managerOnly: true },
]

export function AppLayout() {
  const { me, logout } = useAuth()
  const isManager = me?.role === 'manager'
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    document.body.classList.toggle('topbar-nav-open', navOpen)
    return () => document.body.classList.remove('topbar-nav-open')
  }, [navOpen])

  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  const links = NAV_LINKS.filter((item) => !item.managerOnly || isManager)

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-row">
          <NavLink to="/" end className="brand" onClick={() => setNavOpen(false)}>
            Jove
          </NavLink>
          <div className="spacer" />
          <div className="topbar-actions topbar-actions--desktop">
            <span className="user muted">
              {me?.username} · {me?.role}
            </span>
            <button type="button" className="linkish" onClick={logout}>
              Log out
            </button>
          </div>
          <button
            type="button"
            className="topbar-menu-btn"
            aria-expanded={navOpen}
            aria-controls="topbar-nav"
            aria-label={navOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setNavOpen((open) => !open)}
          >
            <span className="topbar-menu-icon" aria-hidden />
          </button>
        </div>

        <nav id="topbar-nav" className={`topbar-nav${navOpen ? ' is-open' : ''}`}>
          {links.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setNavOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
          <div className="topbar-actions topbar-actions--mobile">
            <span className="user muted">
              {me?.username} · {me?.role}
            </span>
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setNavOpen(false)
                logout()
              }}
            >
              Log out
            </button>
          </div>
        </nav>
      </header>
      {navOpen ? (
        <button
          type="button"
          className="topbar-backdrop"
          aria-label="Close navigation menu"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
