import {
  Navigate,
  Outlet,
  Route,
  createBrowserRouter,
  createRoutesFromElements,
  RouterProvider,
} from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { RequireManager } from './auth/RequireManager'
import { AppLayout } from './components/AppLayout'
import { DashboardPage } from './pages/DashboardPage'
import { FarmPage } from './pages/FarmPage'
import { KitsPage } from './pages/KitsPage'
import { LibraryPage } from './pages/LibraryPage'
import { LoginPage } from './pages/LoginPage'
import { MaterialsPage } from './pages/MaterialsPage'
import { PlannerPage } from './pages/PlannerPage'
import { SettingsPage } from './pages/SettingsPage'

function Protected() {
  const { token, loading } = useAuth()
  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    )
  }
  if (!token) return <Navigate to="/login" replace />
  return <Outlet />
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Protected />}>
        <Route element={<AppLayout />}>
          <Route index element={<FarmPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="kits" element={<KitsPage />} />
          <Route path="materials" element={<MaterialsPage />} />
          <Route element={<RequireManager />}>
            <Route path="planner" element={<PlannerPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="queue" element={<Navigate to="/planner" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </>,
  ),
)

export default function App() {
  return <RouterProvider router={router} />
}
