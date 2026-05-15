import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiFetch, getToken, setToken } from '../api/client'
import { API_URL } from '../config'

type Me = { id: number; username: string; role: string }

type AuthState = {
  token: string | null
  me: Me | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTok] = useState<string | null>(() => getToken())
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshMe = useCallback(async (t: string) => {
    setTok(t)
    setToken(t)
    const m = await apiFetch<Me>('/auth/me')
    setMe(m)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const t = getToken()
      if (!t) {
        if (!cancelled) {
          setMe(null)
          setLoading(false)
        }
        return
      }
      try {
        setTok(t)
        const m = await apiFetch<Me>('/auth/me')
        if (!cancelled) setMe(m)
      } catch {
        if (!cancelled) {
          setTok(null)
          setMe(null)
          setToken(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const t = await res.text()
      throw new Error(t || 'Login failed')
    }
    const data = (await res.json()) as { access_token: string }
    await refreshMe(data.access_token)
  }, [refreshMe])

  const logout = useCallback(() => {
    setTok(null)
    setMe(null)
    setToken(null)
  }, [])

  const value = useMemo(
    () => ({ token, me, loading, login, logout }),
    [token, me, loading, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
