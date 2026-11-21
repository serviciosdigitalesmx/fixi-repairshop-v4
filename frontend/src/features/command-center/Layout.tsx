import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../auth/session'
import { Button, Loading } from '../../components/ui'
import { commandApi } from './api'
import './command-center.css'

const navigation = [
  { path: '/admin', name: 'Vista general', icon: 'overview', end: true },
  { path: '/admin/shops', name: 'Talleres', icon: 'shops' },
  { path: '/admin/users', name: 'Usuarios', icon: 'users' },
  { path: '/admin/plans', name: 'Planes', icon: 'plans' },
  { path: '/admin/subscriptions', name: 'Suscripciones', icon: 'billing' },
  { path: '/admin/audit', name: 'Auditoría', icon: 'audit' }
]
export function CommandIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    shops: 'M3 10h18L19 3H5z M5 10v11h14V10 M9 21v-7h6v7',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    plans: 'M12 3 3 8l9 5 9-5z M3 12l9 5 9-5 M3 16l9 5 9-5',
    billing: 'M3 5h18v14H3z M3 10h18 M7 15h3',
    audit: 'M9 3h6v4H9z M9 5H5v16h14V5h-4 M9 12h6 M9 16h6',
    menu: 'M4 6h16 M4 12h16 M4 18h16', sun: 'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0'
  }
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.overview} /></svg>
}
export function CommandCenterGate() {
  const { user } = useSession()
  const access = useQuery({ queryKey: ['command-access', user?.id], queryFn: commandApi.access, enabled: user?.isSuperAdmin === true, retry: false, staleTime: 0, refetchOnWindowFocus: true })
  if (user?.isSuperAdmin && access.isPending) return <Loading label="Verificando acceso global…" />
  if (!user?.isSuperAdmin || access.isError || !access.data) return <main className="cc-denied"><h1>Acceso exclusivo del propietario de Fixi</h1><p>Tu cuenta no tiene autorización global. Los permisos del taller no conceden acceso a este panel.</p><Link to="/">Volver a mi taller</Link></main>
  return <CommandCenterLayout />
}
function CommandCenterLayout() {
  const { user, logout } = useSession()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark')
  const { pathname } = useLocation()
  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try { localStorage.setItem('fixi-theme', dark ? 'dark' : 'light') } catch { /* storage optional */ }
  }, [dark])
  useEffect(() => {
    if (!open) return
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open])
  const current = navigation.find(n => n.path === pathname)?.name ?? 'Detalle de taller'
  return <div className={`command-center ${collapsed ? 'cc-collapsed' : ''}`}>
    {open && <button className="cc-backdrop" aria-label="Cerrar navegación" onClick={() => setOpen(false)} />}
    <aside className={`cc-sidebar ${open ? 'cc-open' : ''}`} aria-label="Navegación global" id="command-navigation">
      <Link to="/admin" className="cc-brand"><span className="cc-brand-mark">F</span><span className="cc-sidebar-label"><strong>FIXI</strong><small>Command Center</small></span></Link>
      <div className="cc-workspace"><CommandIcon name="plans" /><span className="cc-sidebar-label">Administración global<small>Acceso SuperAdmin</small></span></div>
      <nav aria-label="Command Center"><span className="cc-group-label cc-sidebar-label">PLATAFORMA</span>{navigation.map(n => <NavLink key={n.path} to={n.path} end={n.end} title={n.name} className={({ isActive }) => `cc-nav-item ${isActive ? 'cc-active' : ''}`}><CommandIcon name={n.icon} /><span className="cc-sidebar-label">{n.name}</span></NavLink>)}</nav>
      <div className="cc-sidebar-footer"><Link to="/" className="cc-nav-item" title="Volver a mi taller"><CommandIcon name="shops" /><span className="cc-sidebar-label">Volver a mi taller</span></Link><div className="cc-owner"><span className="cc-avatar">{user?.displayName.slice(0, 1)}</span><div className="cc-sidebar-label"><strong>{user?.displayName}</strong><small>Propietario · SuperAdmin</small></div></div><button className="cc-nav-item" title="Cerrar sesión" onClick={() => void logout()}><span aria-hidden="true">↪</span><span className="cc-sidebar-label">Cerrar sesión</span></button></div>
    </aside>
    <div className="cc-inset"><header className="cc-header"><button className="cc-icon-button cc-desktop-toggle" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}><CommandIcon name="menu" /></button><button className="cc-icon-button cc-mobile-toggle" aria-expanded={open} aria-controls="command-navigation" aria-label="Abrir navegación" onClick={() => setOpen(!open)}><CommandIcon name="menu" /></button><div className="cc-breadcrumb"><span>Plataforma</span><span>/</span><strong>{current}</strong></div><span className="cc-global-badge">Acceso global</span><button className="cc-icon-button" onClick={() => setDark(!dark)} aria-label={dark ? 'Usar modo claro' : 'Usar modo oscuro'}><CommandIcon name="sun" /></button></header>
      <main id="command-content" className="cc-main"><Outlet /></main><footer className="cc-page-footer">FIXI Command Center · Operaciones administrativas auditadas</footer>
    </div>
  </div>
}
export function CommandNotFound() { return <div><h1>Sección no encontrada</h1><Link to="/admin"><Button>Ir a vista general</Button></Link></div> }
