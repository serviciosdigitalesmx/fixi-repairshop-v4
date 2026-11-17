import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { authApi } from '../api/endpoints'
import { hasSessionHint, onSessionChange, refreshSession, setAccessToken, setSessionHint } from '../api/http'
import type { LoginResponse, Permission, Role, ShopAccess, UserResponse } from '../api/types'
import { resetAccountReminders } from '../lib/accountReminders'

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; user: UserResponse; shops: ShopAccess[]; permissions: Permission[] }

interface SessionContextValue {
  state: SessionState
  user: UserResponse | null
  shops: ShopAccess[]
  role: Role | null
  can: (permission: Permission) => boolean
  login: (email: string, password: string) => Promise<void>
  acceptSession: (session: LoginResponse) => void
  logout: () => Promise<void>
  switchShop: (shopId: string) => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const queryClient = useQueryClient()
  const currentAccess = useRef<Pick<LoginResponse, 'user' | 'permissions'> | null>(null)

  const apply = useCallback((session: LoginResponse | null) => {
    setSessionHint(!!session)
    if (!session) {
      currentAccess.current = null
      setAccessToken(null)
      setState({ status: 'anonymous' })
      return
    }
    const previous = currentAccess.current
    const sameContext = previous?.user.id === session.user.id && previous.user.shopId === session.user.shopId
    const permissionsChanged = sameContext && (previous.user.role !== session.user.role || previous.permissions.length !== session.permissions.length || previous.permissions.some(p => !session.permissions.includes(p)))
    currentAccess.current = { user: session.user, permissions: [...session.permissions] }
    setAccessToken(session.accessToken)
    if (permissionsChanged) {
      queryClient.clear()
      if (previous.permissions.some(p => !session.permissions.includes(p))) toast.warning('Tu cuenta no tiene permiso para realizar esta acción. Consulta al administrador.')
      else toast.info('Tus permisos se actualizaron. La pantalla se ha actualizado.')
    }
    setState({ status: 'authenticated', user: session.user, shops: session.shops, permissions: session.permissions })
  }, [queryClient])

  // Restore the session from the refresh cookie on load; keep it fresh before the access token expires.
  useEffect(() => {
    onSessionChange((s) => apply(s))
    if (hasSessionHint()) void refreshSession().then((s) => apply(s))
    else apply(null)
  }, [apply])

  useEffect(() => {
    if (state.status !== 'authenticated') return
    const id = window.setInterval(() => void refreshSession(), 10 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [state.status])

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await authApi.login(email, password)
      resetAccountReminders()
      queryClient.clear()
      apply(session)
    },
    [apply, queryClient]
  )

  const logout = useCallback(async () => {
    await authApi.logout()
    resetAccountReminders()
    queryClient.clear()
    apply(null)
  }, [apply, queryClient])

  const switchShop = useCallback(
    async (shopId: string) => {
      const session = await authApi.switchShop(shopId)
      resetAccountReminders()
      queryClient.clear()
      apply(session)
    },
    [apply, queryClient]
  )

  const value = useMemo<SessionContextValue>(() => {
    const auth = state.status === 'authenticated' ? state : null
    return {
      state,
      user: auth?.user ?? null,
      shops: auth?.shops ?? [],
      role: auth?.user.role ?? null,
      can: (p) => !!auth?.permissions.includes(p),
      login,
      acceptSession: (s) => {
        resetAccountReminders()
        queryClient.clear()
        apply(s)
      },
      logout,
      switchShop,
    }
  }, [state, login, logout, switchShop, apply, queryClient])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside SessionProvider')
  return ctx
}
