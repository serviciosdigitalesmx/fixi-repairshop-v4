import { lazy, Suspense, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { errorMessage } from '../../api/http'
import type { Page } from '../../api/types'
import { Button, ErrorState, Field, Input, Loading, Modal, Select } from '../../components/ui'
import { useDebounced } from '../../lib/hooks'
import { commandApi, type PlanRow, type ShopRow, type SubscriptionRow, type UserRow } from './api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './Card'
import { CommandIcon } from './Layout'

const AnalyticsCharts = lazy(() => import('./Charts'))
const date = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(value)) : 'Sin vencimiento'
const money = (value: number, currency = 'MXN') => new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(value)
const roles = [{ value: 'Admin', label: 'Administrador de taller' }, { value: 'Reception', label: 'Recepción' }, { value: 'Tech', label: 'Técnico' }, { value: 'Cashier', label: 'Caja' }]
const planOptions = [{ value: 'Basic', label: 'Básico' }, { value: 'Standard', label: 'Estándar' }, { value: 'Pro', label: 'Profesional' }]
const statusNames: Record<string, string> = { Trialing: 'En prueba', Active: 'Activa', Suspended: 'Suspendido', OrganizationSuspended: 'Organización suspendida', PastDue: 'Pago pendiente', Canceled: 'Cancelada', Expired: 'Vencida', Basic: 'Básico', Standard: 'Estándar', Pro: 'Profesional', Manual: 'Bonificada', None: 'Sin proveedor' }
function label(value: string | null) { return value ? statusNames[value] ?? value : 'Sin suscripción' }
function Status({ value }: { value: string }) { return <span className={`cc-status cc-status-${value.toLowerCase()}`}>{label(value)}</span> }
function Heading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="cc-heading"><div><p className="cc-eyebrow">FIXI / COMMAND CENTER</p><h1>{title}</h1><p className="cc-muted">{description}</p></div>{action}</div>
}
function QueryState({ pending, error, retry }: { pending: boolean; error: Error | null; retry: () => unknown }) {
  if (pending) return <Loading label="Consultando datos de la plataforma…" />
  if (error) return <ErrorState error={errorMessage(error)} onRetry={() => { void retry() }} />
  return null
}
function useList() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const search = useDebounced(q, 300)
  const skip = Math.max(0, Number(params.get('skip')) || 0)
  const update = (key: string, value: string) => setParams(previous => { const next = new URLSearchParams(previous); next.delete('skip'); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true })
  return { params, q, search, skip, update, page: (value: number) => setParams(previous => { const next = new URLSearchParams(previous); next.set('skip', String(value)); return next }) }
}
function Filters({ list, children }: { list: ReturnType<typeof useList>; children?: ReactNode }) {
  return <div className="cc-filters"><Input aria-label="Buscar registros" placeholder="Buscar por nombre o correo…" value={list.q} onChange={e => list.update('q', e.target.value)} />{children}</div>
}
function Pagination({ data, list }: { data: Page<unknown>; list: ReturnType<typeof useList> }) {
  return <div className="cc-pagination"><span>{data.total ? `${list.skip + 1}–${Math.min(list.skip + 25, data.total)}` : '0'} de {data.total} registros</span><Button size="sm" disabled={list.skip === 0} onClick={() => list.page(Math.max(0, list.skip - 25))}>Anterior</Button><Button size="sm" disabled={list.skip + 25 >= data.total} onClick={() => list.page(list.skip + 25)}>Siguiente</Button></div>
}
function Empty({ colSpan }: { colSpan: number }) { return <tr><td colSpan={colSpan} className="cc-empty">No hay registros que coincidan con los filtros.</td></tr> }

interface FormField { name: string; label: string; value?: string | number; type?: string; options?: { value: string; label: string }[]; min?: number; max?: number; minLength?: number; maxLength?: number; step?: string }
function OperationDialog({ title, description, fields, perform, onClose, reason = true, children }: {
  title: string; description: string; fields: FormField[]; perform: (values: Record<string, string>) => Promise<unknown>;
  onClose: () => void; reason?: boolean; children?: ReactNode;
}) {
  const client = useQueryClient()
  const mutation = useMutation({ mutationFn: perform, onSuccess: async () => {
    await client.invalidateQueries({ queryKey: ['command'] }); await client.invalidateQueries({ queryKey: ['billing'] })
    toast.success('Cambio guardado y registrado en auditoría'); onClose()
  } })
  return <Modal open title={title} description={description} onClose={() => { if (!mutation.isPending) onClose() }}>
    <form className="cc-form" onSubmit={e => { e.preventDefault(); if (!mutation.isPending) mutation.mutate(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>) }}>
      {fields.map(f => <Field key={f.name} label={f.label} required>{f.options ? <Select name={f.name} defaultValue={f.value} required>{f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select> : <Input name={f.name} type={f.type ?? 'text'} defaultValue={f.value} min={f.min} max={f.max} step={f.step} minLength={f.minLength} maxLength={f.maxLength ?? 180} required />}</Field>)}
      {children}
      {reason && <Field label="Motivo del cambio" required><Input name="reason" minLength={5} maxLength={500} required placeholder="Explica por qué realizas esta operación" /></Field>}
      {mutation.isError && <div role="alert" className="cc-form-error">{errorMessage(mutation.error)}</div>}
      <div className="cc-dialog-actions"><Button disabled={mutation.isPending} onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" loading={mutation.isPending}>Confirmar y guardar</Button></div>
    </form>
  </Modal>
}

export function CommandDashboard() {
  const query = useQuery({ queryKey: ['command', 'dashboard'], queryFn: commandApi.dashboard })
  const d = query.data
  return <><Heading title="Tu plataforma, en perspectiva." description="Talleres, cuentas y suscripciones conectados a la información real de Fixi." action={<Button onClick={() => void query.refetch()} disabled={query.isFetching}>Actualizar datos</Button>} />
    <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
    {d && <><div className="cc-stats">{[
      { title: 'Talleres registrados', value: d.shops, note: `${d.organizations} organizaciones · ${d.activeShops} talleres activos`, icon: 'shops' },
      { title: 'Suscripciones activas', value: d.activeSubscriptions, note: `${d.trials} en prueba gratuita`, icon: 'billing' },
      { title: 'Vencen en 15 días', value: d.expiring, note: `${d.expired} suscripciones vencidas`, icon: 'audit' },
      { title: 'Usuarios registrados', value: d.users, note: 'Cuentas reales de la plataforma', icon: 'users' }
    ].map(s => <Card key={s.title}><CardContent><div className="cc-stat-title">{s.title}<CommandIcon name={s.icon} /></div><strong className="cc-stat-value">{s.value.toLocaleString('es-MX')}</strong><p className="cc-muted">{s.note}</p></CardContent></Card>)}</div>
      <Suspense fallback={<Loading label="Cargando gráficas…" />}><AnalyticsCharts data={d} /></Suspense>
      <Card><CardHeader><CardTitle>Ingresos recurrentes contratados (MRR)</CardTitle><CardDescription>{d.revenueNote}</CardDescription></CardHeader><CardContent><div className="cc-revenue">{d.monthlyRecurringRevenue.length ? d.monthlyRecurringRevenue.map(r => <div key={r.currency}><span>{r.currency} / mes</span><strong>{money(r.amount, r.currency)}</strong></div>) : <p className="cc-muted">No hay importes recurrentes de suscripciones activas con proveedor de cobro.</p>}</div><p className="cc-disclosure">Ingresos efectivamente cobrados: no disponibles en la fuente actual. Las ventas y reparaciones de los talleres no se cuentan como ingresos de Fixi.</p></CardContent></Card>
      <p className="cc-updated">Última consulta: {new Date(d.generatedAtUtc).toLocaleString('es-MX')}</p>
    </>}
  </>
}

export function CommandShops() {
  const list = useList(); const active = list.params.get('active') ?? ''
  const query = useQuery({ queryKey: ['command', 'shops', list.search, active, list.skip], queryFn: () => commandApi.shops({ q: list.search || undefined, active: active || undefined, skip: list.skip }) })
  const [create, setCreate] = useState(false); const [selected, setSelected] = useState<ShopRow | null>(null)
  return <><Heading title="Talleres" description="Administra organizaciones y sucursales sin acceder a sus operaciones comerciales." action={<Button variant="primary" onClick={() => setCreate(true)}>+ Registrar taller</Button>} />
    <Card><CardHeader><CardTitle>Directorio de talleres</CardTitle><Filters list={list}><Select aria-label="Estado del taller" value={active} onChange={e => list.update('active', e.target.value)}><option value="">Todos los estados</option><option value="true">Activos</option><option value="false">Suspendidos</option></Select></Filters></CardHeader><QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
      {query.data && <><div className="cc-table-scroll"><table><thead><tr><th>Taller</th><th>Estado</th><th>Plan</th><th>Usuarios</th><th>Vencimiento</th><th>Acciones</th></tr></thead><tbody>{query.data.items.map(s => <tr key={s.id}><td><Link className="cc-table-link" to={`/admin/shops/${s.id}`}>{s.name}</Link><small>{s.id === s.organizationId ? 'Organización principal' : 'Sucursal'} · {s.country}</small></td><td><Status value={!s.organizationIsActive ? 'OrganizationSuspended' : s.isActive ? 'Active' : 'Suspended'} /></td><td>{label(s.plan)}<small>{label(s.subscriptionStatus)}</small></td><td>{s.users}</td><td>{date(s.expiresAtUtc)}</td><td>{!s.organizationIsActive && s.id !== s.organizationId ? <Link to={`/admin/shops/${s.organizationId}`}>Ver organización →</Link> : <Button size="sm" onClick={() => setSelected(s)}>{s.isActive ? 'Suspender' : 'Reactivar'}</Button>}</td></tr>)}{!query.data.items.length && <Empty colSpan={6} />}</tbody></table></div><Pagination data={query.data} list={list} /></>}
    </Card>
    {create && <OperationDialog title="Registrar taller" description="Crea una organización mexicana, una prueba Pro de 15 días y una invitación para su propietario. No se genera ni comparte una contraseña." reason={false} onClose={() => setCreate(false)} fields={[{ name: 'name', label: 'Nombre del taller', minLength: 2, maxLength: 120 }, { name: 'ownerName', label: 'Nombre del propietario', minLength: 2, maxLength: 120 }, { name: 'ownerEmail', label: 'Correo del propietario', type: 'email' }]} perform={commandApi.register} />}
    {selected && <OperationDialog title={selected.isActive ? 'Suspender taller' : 'Reactivar taller'} description={`${selected.name}. Suspender la organización principal bloquea todas sus sucursales. Una suspensión de sucursal solo bloquea esa sucursal. No se cancelan cargos ni se elimina información; los administradores de taller no pueden revertir una suspensión global.`} fields={[]} onClose={() => setSelected(null)} perform={v => commandApi.activate(selected.id, { isActive: !selected.isActive, reason: v.reason, expectedUpdatedAtUtc: selected.updatedAtUtc })} />}
  </>
}

export function CommandShopDetail() {
  const { id = '' } = useParams()
  const [activation, setActivation] = useState(false)
  const query = useQuery({ queryKey: ['command', 'shop', id], queryFn: () => commandApi.shop(id) })
  const d = query.data
  return <><Link className="cc-back-link" to="/admin/shops">← Todos los talleres</Link><Heading title={d?.shop.name ?? 'Detalle del taller'} description="Información administrativa de la organización y sus sucursales." action={d && (d.shop.organizationIsActive || d.shop.id === d.shop.organizationId) ? <Button onClick={() => setActivation(true)}>{d.shop.isActive ? 'Suspender' : 'Reactivar'}</Button> : d ? <Link to={`/admin/shops/${d.shop.organizationId}`}>Ver organización principal →</Link> : undefined} />
    <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />{d && <><div className="cc-stats"><Card><CardContent><p className="cc-muted">Estado del taller</p><Status value={!d.shop.organizationIsActive ? 'OrganizationSuspended' : d.shop.isActive ? 'Active' : 'Suspended'} /><p>Registrado {date(d.shop.createdAtUtc)}</p></CardContent></Card><Card><CardContent><p className="cc-muted">Suscripción</p><strong className="cc-stat-value">{label(d.shop.plan)}</strong><p>{label(d.shop.subscriptionStatus)}</p></CardContent></Card><Card><CardContent><p className="cc-muted">Sucursales</p><strong className="cc-stat-value">{d.shop.branches}</strong><p>Organización {d.shop.organizationId}</p></CardContent></Card><Card><CardContent><p className="cc-muted">Cuentas principales</p><strong className="cc-stat-value">{d.shop.users}</strong><Link to={`/admin/users?shopId=${d.shop.id}`}>Administrar usuarios →</Link></CardContent></Card></div>
      <Card><CardHeader><CardTitle>Sucursales de la organización</CardTitle></CardHeader><div className="cc-table-scroll"><table><thead><tr><th>Nombre</th><th>Estado</th><th>Registro</th></tr></thead><tbody>{d.branches.map(s => <tr key={s.id}><td><Link to={`/admin/shops/${s.id}`}>{s.name}</Link></td><td><Status value={!s.organizationIsActive ? 'OrganizationSuspended' : s.isActive ? 'Active' : 'Suspended'} /></td><td>{date(s.createdAtUtc)}</td></tr>)}</tbody></table></div></Card>
      <Card><CardHeader><CardTitle>Suscripción de la organización</CardTitle></CardHeader><CardContent>{d.subscription ? <><p>{label(d.subscription.plan)} · {label(d.subscription.status)} · {label(d.subscription.provider)}</p><p>Fin de prueba: {date(d.subscription.trialEndsAtUtc)} · Fin de período: {date(d.subscription.currentPeriodEndsAtUtc)}</p><Link to={`/admin/subscriptions?q=${encodeURIComponent(d.subscription.shopName)}`}>Administrar suscripción →</Link></> : <p>No existe una suscripción registrada.</p>}</CardContent></Card>
    </>}{d && activation && <OperationDialog title={d.shop.isActive ? 'Suspender taller' : 'Reactivar taller'} description="La suspensión global de una organización bloquea el acceso de todas sus sucursales sin modificar sus estados individuales ni cancelar cargos del proveedor." fields={[]} onClose={() => setActivation(false)} perform={v => commandApi.activate(d.shop.id, { isActive: !d.shop.isActive, reason: v.reason, expectedUpdatedAtUtc: d.shop.updatedAtUtc })} />}</>
}

function ShopPicker() {
  const [search, setSearch] = useState(''); const debounced = useDebounced(search, 250)
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null)
  const query = useQuery({ queryKey: ['command', 'shop-picker', debounced], queryFn: () => commandApi.shops({ q: debounced || undefined, active: true, take: 100 }) })
  return <><Field label="Buscar taller de destino"><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrar talleres por nombre" /></Field><Field label="Taller de destino" required><Select name="shopId" required value={selected?.id ?? ''} aria-busy={query.isFetching} onChange={e => {
    const shop = query.data?.items.find(s => s.id === e.target.value)
    if (shop) setSelected({ id: shop.id, name: shop.name })
  }}><option value="" disabled>Selecciona un taller activo</option>{selected && !query.data?.items.some(s => s.id === selected.id) && <option value={selected.id}>{selected.name}</option>}{query.data?.items.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>{query.isError && <div role="alert">{errorMessage(query.error)}</div>}</>
}
export function CommandUsers() {
  const list = useList(); const active = list.params.get('active') ?? ''; const shopId = list.params.get('shopId') ?? ''
  const query = useQuery({ queryKey: ['command', 'users', list.search, active, shopId, list.skip], queryFn: () => commandApi.users({ q: list.search || undefined, active: active || undefined, shopId: shopId || undefined, skip: list.skip }) })
  const [invite, setInvite] = useState(false); const [selected, setSelected] = useState<UserRow | null>(null)
  return <><Heading title="Usuarios" description="Cuentas y roles de taller. El privilegio SuperAdmin solo se concede por comando del propietario en el servidor." action={<Button variant="primary" onClick={() => setInvite(true)}>+ Invitar usuario</Button>} />
    {shopId && <p className="cc-disclosure">Filtrando cuentas principales del taller seleccionado. <button onClick={() => list.update('shopId', '')}>Ver todos los talleres</button></p>}
    <Card><CardHeader><CardTitle>Directorio de cuentas</CardTitle><Filters list={list}><Select aria-label="Estado de usuario" value={active} onChange={e => list.update('active', e.target.value)}><option value="">Todos</option><option value="true">Activos</option><option value="false">Desactivados</option></Select></Filters></CardHeader><QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
      {query.data && <><div className="cc-table-scroll"><table><thead><tr><th>Usuario</th><th>Taller principal</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acciones</th></tr></thead><tbody>{query.data.items.map(u => <tr key={u.id}><td><strong>{u.displayName}</strong><small>{u.email}</small></td><td><Link to={`/admin/shops/${u.shopId}`}>{u.shopName}</Link></td><td>{u.isSuperAdmin ? 'SuperAdmin' : roles.find(r => r.value === u.role)?.label}</td><td><Status value={u.isActive ? 'Active' : 'Suspended'} />{u.hasPendingInvitation && <small>Invitación pendiente</small>}</td><td>{u.lastLoginAtUtc ? date(u.lastLoginAtUtc) : 'Sin acceso registrado'}</td><td>{u.isSuperAdmin ? <span className="cc-muted">Protegido · servidor</span> : <Button size="sm" onClick={() => setSelected(u)}>Editar</Button>}</td></tr>)}{!query.data.items.length && <Empty colSpan={6} />}</tbody></table></div><Pagination data={query.data} list={list} /></>}
    </Card>
    {invite && <OperationDialog title="Invitar usuario" description="La invitación se añade al canal de correo configurado. No se exponen contraseñas ni enlaces de recuperación en el panel." reason={false} onClose={() => setInvite(false)} fields={[{ name: 'displayName', label: 'Nombre', minLength: 2, maxLength: 120 }, { name: 'email', label: 'Correo', type: 'email' }, { name: 'role', label: 'Rol de taller', value: 'Tech', options: roles }]} perform={commandApi.invite}><ShopPicker /></OperationDialog>}
    {selected && <OperationDialog title="Administrar usuario" description={`${selected.email}. Cambiar el rol o desactivar la cuenta invalida sus sesiones. Debe permanecer un administrador activo por taller.`} onClose={() => setSelected(null)} fields={[{ name: 'displayName', label: 'Nombre', value: selected.displayName, minLength: 2, maxLength: 120 }, { name: 'role', label: 'Rol del taller principal', value: selected.role, options: roles }, { name: 'isActive', label: 'Acceso a la cuenta', value: String(selected.isActive), options: [{ value: 'true', label: 'Activo' }, { value: 'false', label: 'Desactivado' }] }]} perform={v => commandApi.updateUser(selected.id, { ...v, isActive: v.isActive === 'true', expectedUpdatedAtUtc: selected.updatedAtUtc })} />}
  </>
}

export function CommandSubscriptions() {
  const list = useList(); const status = list.params.get('status') ?? ''
  const query = useQuery({ queryKey: ['command', 'subscriptions', list.search, status, list.skip], queryFn: () => commandApi.subscriptions({ q: list.search || undefined, status: status || undefined, skip: list.skip }) })
  const [selected, setSelected] = useState<SubscriptionRow | null>(null)
  return <><Heading title="Suscripciones" description="Pruebas de 15 días, planes bonificados y estado real de los contratos de la plataforma." />
    <Card><CardHeader><CardTitle>Ciclo de suscripción</CardTitle><Filters list={list}><Select aria-label="Estado de suscripción" value={status} onChange={e => list.update('status', e.target.value)}><option value="">Todos los estados</option>{['Trialing', 'Active', 'PastDue', 'Canceled', 'Expired'].map(s => <option key={s} value={s}>{label(s)}</option>)}</Select></Filters></CardHeader><QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
      {query.data && <><div className="cc-table-scroll"><table><thead><tr><th>Organización</th><th>Plan</th><th>Estado</th><th>Proveedor</th><th>Vencimiento</th><th>Importe contratado</th><th>Acciones</th></tr></thead><tbody>{query.data.items.map(s => <tr key={s.organizationId}><td><Link to={`/admin/shops/${s.organizationId}`}>{s.shopName}</Link></td><td>{label(s.plan)}</td><td><Status value={s.status} /></td><td>{label(s.provider)}</td><td>{date(s.status === 'Trialing' ? s.trialEndsAtUtc : s.currentPeriodEndsAtUtc)}</td><td>{s.amount !== null && s.currency ? money(s.amount, s.currency) : 'Sin cargo registrado'}</td><td>{s.externallyManaged ? <span className="cc-muted">Gestionado por proveedor<small>Utiliza el flujo de facturación del taller</small></span> : <Button size="sm" onClick={() => setSelected(s)}>Gestionar</Button>}</td></tr>)}{!query.data.items.length && <Empty colSpan={7} />}</tbody></table></div><Pagination data={query.data} list={list} /></>}
    </Card>
    {selected && <OperationDialog title="Gestionar suscripción" description={`${selected.shopName}. Una bonificación no representa un cobro. Reiniciar una prueba concede Pro durante 15 días. Cancelar una suscripción local deja al taller en modo consulta conforme a sus reglas existentes.`} onClose={() => setSelected(null)} fields={[{ name: 'action', label: 'Operación', value: 'plan', options: [{ value: 'plan', label: 'Cambiar plan local' }, { value: 'complimentary', label: 'Bonificar plan sin vencimiento' }, { value: 'trial', label: 'Reiniciar prueba Pro de 15 días' }, { value: 'cancel', label: 'Cancelar suscripción local' }] }, { name: 'plan', label: 'Plan (cambio local o bonificación)', value: selected.plan, options: planOptions }]} perform={v => commandApi.subscription(selected.organizationId, { ...v, expectedUpdatedAtUtc: selected.updatedAtUtc })} />}
  </>
}

export function CommandPlans() {
  const query = useQuery({ queryKey: ['command', 'plans'], queryFn: commandApi.plans })
  const [selected, setSelected] = useState<PlanRow | null>(null)
  return <><Heading title="Planes de Fixi" description="Catálogo comercial mexicano. Conserva los módulos y límites reales de la arquitectura existente." />
    <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
    {query.data && <><div className="cc-plan-grid">{query.data.plans.map(p => <Card key={p.definition.id} className={p.definition.id === 'Pro' ? 'cc-featured-plan' : ''}><CardHeader><span className="cc-eyebrow">{p.definition.id === 'Pro' ? 'TODOS LOS MÓDULOS' : 'SUSCRIPCIÓN MENSUAL'}</span><CardTitle>{p.definition.name}</CardTitle></CardHeader><CardContent><strong className="cc-plan-price">{p.definition.price !== null ? money(p.definition.price) : 'No configurado'}</strong><p className="cc-muted">MXN / mes</p><ul className="cc-features"><li>Hasta {p.definition.maxBranches} sucursal{p.definition.maxBranches !== 1 ? 'es' : ''}</li><li>Órdenes, recepción, inventario y mostrador</li>{p.definition.modules.map(m => <li key={m}>{({ purchasing: 'Compras y proveedores', reports: 'Reportes detallados', transfers: 'Transferencias', audit: 'Auditoría de taller', ai: 'Asistencia de diagnóstico' } as Record<string, string>)[m] ?? m}</li>)}</ul><Button onClick={() => setSelected(p)}>Editar precio MXN</Button></CardContent></Card>)}</div><p className="cc-disclosure">La prueba de altas administrativas dura 15 días. El alta pública usa la configuración vigente ({query.data.trialDays} días). Los precios nuevos se aplican a futuros checkouts; los contratos existentes mantienen su importe hasta un cambio explícito por su flujo de facturación.</p></>}
    {selected && <OperationDialog title={`Precio de ${selected.definition.name}`} description="Actualiza el catálogo MXN y los futuros checkouts. No altera cargos ni renovaciones de contratos existentes." onClose={() => setSelected(null)} fields={[{ name: 'monthlyPrice', label: 'Precio mensual MXN', type: 'number', value: selected.definition.price ?? '', min: 0.01, max: 1000000, step: '0.01' }]} perform={v => commandApi.price(selected.definition.id, { monthlyPrice: Number(v.monthlyPrice), reason: v.reason, expectedUpdatedAtUtc: selected.updatedAtUtc })} />}
  </>
}

export function CommandAudit() {
  const list = useList()
  const query = useQuery({ queryKey: ['command', 'audit', list.search, list.skip], queryFn: () => commandApi.audit({ q: list.search || undefined, skip: list.skip }) })
  return <><Heading title="Auditoría global" description="Trazabilidad de altas, suspensiones, permisos, planes y cambios administrativos. Sin acciones de eliminación." />
    <Card><CardHeader><CardTitle>Operaciones sensibles</CardTitle><Filters list={list} /></CardHeader><QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
      {query.data && <><div className="cc-table-scroll"><table><thead><tr><th>Fecha</th><th>Actor</th><th>Operación</th><th>Entidad</th><th>Detalle</th></tr></thead><tbody>{query.data.items.map(a => <tr key={a.id}><td>{new Date(a.createdAtUtc).toLocaleString('es-MX')}</td><td>{a.actorEmail ?? 'Comando del servidor'}</td><td>{a.action}</td><td>{a.entityType}<small>{a.entityId}</small></td><td>{a.dataJson && <details><summary>Ver cambio</summary><pre className="cc-audit-json">{formatJson(a.dataJson)}</pre></details>}</td></tr>)}{!query.data.items.length && <Empty colSpan={5} />}</tbody></table></div><Pagination data={query.data} list={list} /></>}
    </Card></>
}
function formatJson(value: string) { try { return JSON.stringify(JSON.parse(value), null, 2) } catch { return value } }
