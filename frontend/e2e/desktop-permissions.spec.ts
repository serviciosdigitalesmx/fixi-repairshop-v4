import { test, expect } from './web-fixtures'
import { USERS, uniquePhone } from './helpers'
import { randomBytes } from 'node:crypto'
import { signIn } from './desktop-support'
import type { Customer, RepairOrder } from '../src/api/types'
import fs from 'node:fs/promises'

const common = ['/', '/orders', '/orders/board', '/customers', '/inventory', '/profile']
const sales = ['/pos', '/sales', '/cash', '/invoices', '/invoices?tab=rates']
const admin = ['/purchases', '/transfers', '/reports?r=revenue', '/reports?r=margins', '/reports?r=repair-times', '/reports?r=quotes', '/reports?r=top-issues', '/reports?r=technicians', '/reports?r=warranty', '/reports?r=feedback', '/reports?r=inventory', '/settings?tab=general', '/settings?tab=operation', '/settings?tab=templates', '/settings?tab=integrations', '/settings?tab=users', '/settings?tab=branches', '/settings?tab=audit', '/billing']
const technical = /Request failed|AxiosError|status code\s*\d{3}|HTTP\s*(403|500)|Forbidden/i

for (const role of ['admin', 'tech', 'reception', 'cashier'] as const) test(`permissions UX: ${role} allowed screens and actions never issue forbidden requests`, async ({ page }) => {
  test.setTimeout(360_000)
  const problems: string[] = []
  page.on('response', response => {
    if (response.url().includes('/api/v1/') && response.status() >= 400 && !response.url().includes('/auth/refresh')) problems.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`)
  })
  page.on('pageerror', error => problems.push(error.message))
  const api = await signIn(page, role)
  const routes = [...common, ...(role !== 'cashier' ? ['/orders/new', '/messages'] : []), ...(role !== 'tech' ? sales : []), ...(role === 'admin' ? admin : [])]
  const orders = await api.read<RepairOrder[]>('/orders?take=100')
  const order = orders.find(o => o.status === 'Received')!
  expect(order).toBeTruthy()
  routes.push(`/customers/${order.customerId}`)
  for (const route of routes) await test.step(route, async () => {
    await page.goto(route)
    await expect(page.locator('main h1').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    const text = await page.locator('main').innerText()
    if (technical.test(text)) problems.push(`Technical message on ${route}`)
  })
  await page.goto('/orders/board')
  const receivedCard = page.locator('article.fixi-board-card').filter({ has: page.getByRole('link', { name: order.code, exact: true }) })
  if (role !== 'cashier') await expect(receivedCard).toHaveAttribute('aria-roledescription', 'draggable')
  await page.goto(`/orders/${order.id}`)
  for (const tab of ['Cotizaciones', 'Refacciones', 'Pagos', 'Checklists', 'Notas', 'Fotos', 'Mensajes', 'Historial', ...(role !== 'cashier' ? ['Sugerencias'] : [])]) await test.step(`order tab ${tab}`, async () => {
    await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click()
    await page.waitForLoadState('networkidle')
    if (technical.test(await page.locator('main').innerText())) problems.push(`Technical message on order tab ${tab}`)
  })
  await page.goto(`/orders/${order.id}?tab=checks`)
  if (role === 'cashier') {
    await expect(page.getByRole('button', { name: 'Generar enlace nuevo', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Editar falla', exact: true })).toHaveCount(0)
    await page.goto(`/orders/${order.id}?tab=payments`)
    await expect(page.getByRole('button', { name: 'Registrar pago / seña', exact: true })).toBeVisible()
  }
  if (role === 'tech') {
    await page.goto(`/orders/${order.id}?tab=payments`)
    await expect(page.getByRole('button', { name: 'Registrar pago / seña', exact: true })).toHaveCount(0)
  }
  const forbidden = role === 'admin' ? [] : ['/settings', '/reports', '/purchases', '/transfers', '/billing', ...(role === 'tech' ? ['/pos', '/cash', '/sales', '/invoices'] : []), ...(role === 'cashier' ? ['/orders/new', '/messages'] : [])]
  for (const route of forbidden) await test.step(`blocked route ${route}`, async () => {
    await page.goto(route)
    await expect(page.getByText('No tienes permiso para ver esta sección.', { exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
  })
  await fs.writeFile(test.info().outputPath('permission-ui-problems.json'), JSON.stringify({ role, routes, forbidden, problems }, null, 2))
  expect(problems).toEqual([])
})

test('permissions UX: cashier deep link cannot mount a hidden protected order tab', async ({ page }) => {
  const api = await signIn(page, 'cashier')
  const order = (await api.read<RepairOrder[]>('/orders?take=1'))[0]
  const rejected: string[] = []
  page.on('response', r => { if (r.status() === 403 && r.url().includes('/api/v1/')) rejected.push(new URL(r.url()).pathname) })
  await page.goto(`/orders/${order.id}?tab=suggestions`)
  await expect(page.getByText('No tienes permiso para ver esta sección.', { exact: true })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(rejected).toEqual([])
  await page.reload()
  await expect(page.getByText('No tienes permiso para ver esta sección.', { exact: true })).toBeVisible()
  expect((await api.get(`/orders/${order.id}/suggestions`)).status()).toBe(403)
})

test('permissions UX: cashier cannot drag a received order into workshop states', async ({ page }) => {
  const api = await signIn(page, 'cashier')
  const order = (await api.read<RepairOrder[]>('/orders?status=Received&take=1'))[0]
  expect(order).toBeTruthy()
  await page.goto('/orders/board')
  const card = page.locator('article.fixi-board-card').filter({ has: page.getByRole('link', { name: order.code, exact: true }) })
  await expect(card).toBeVisible()
  await expect(card).not.toHaveAttribute('aria-roledescription', 'draggable')
  const denied = await api.post(`/orders/${order.id}/status`, { status: 'Diagnosing', enqueueOutbox: false })
  expect(denied.status()).toBe(403)
  expect((await api.read<RepairOrder>(`/orders/${order.id}`)).status).toBe('Received')
})

test('permissions UX: a real role change rejects a stale form with a human message and preserves data', async ({ page, request }) => {
  const adminLogin = await request.post('/api/v1/auth/login', { data: USERS.admin })
  expect(adminLogin.ok()).toBeTruthy()
  const adminHeaders = { Authorization: `Bearer ${(await adminLogin.json()).data.accessToken}` }
  const email = `permissions-${Date.now()}@example.invalid`
  const password = 'QA_' + randomBytes(16).toString('hex')
  const invitation = await request.post('/api/v1/users', { headers: adminHeaders, data: { email, displayName: 'QA permisos cambiantes', role: 'Reception' } })
  expect(invitation.ok()).toBeTruthy()
  const invited = (await invitation.json()).data
  const accepted = await request.post('/api/v1/auth/accept-invitation', { data: { token: new URL(invited.url).searchParams.get('token'), password } })
  expect(accepted.ok()).toBeTruthy()
  await page.goto('/login')
  await page.getByLabel('Correo electrónico').fill(email)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  const signedIn = page.waitForResponse(r => r.url().endsWith('/auth/login') && r.ok())
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await signedIn
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible()
  await page.goto('/customers')
  await page.getByRole('button', { name: '+ Nuevo cliente', exact: true }).click()
  const name = `QA operación rechazada ${Date.now()}`
  await page.getByLabel('Nombre y apellido').fill(name)
  await page.getByLabel('Teléfono / WhatsApp').fill(uniquePhone())
  const changed = await request.put(`/api/v1/users/${invited.user.id}`, { headers: adminHeaders, data: { displayName: invited.user.displayName, role: 'Cashier', isActive: true } })
  expect(changed.ok()).toBeTruthy()
  const denied = page.waitForResponse(r => r.url().endsWith('/customers') && r.request().method() === 'POST' && r.status() === 403)
  await page.getByRole('dialog').getByRole('button', { name: 'Crear cliente', exact: true }).click()
  await denied
  await expect(page.getByText('Tu cuenta no tiene permiso para realizar esta acción. Consulta al administrador.', { exact: true })).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Crear cliente', exact: true })).toHaveCount(0)
  await test.info().attach('permission-changed', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
  expect(await page.locator('main').innerText()).not.toMatch(technical)
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: '+ Nuevo cliente', exact: true })).toHaveCount(0)
  const users = await request.get('/api/v1/users', { headers: adminHeaders })
  expect(users.ok()).toBeTruthy()
  expect((await users.json()).data.find((u: { id: string }) => u.id === invited.user.id).role).toBe('Cashier')
  const lookup = await request.get(`/api/v1/customers?q=${encodeURIComponent(name)}`, { headers: adminHeaders })
  expect(lookup.ok()).toBeTruthy()
  expect((await lookup.json()).data).toHaveLength(0)
})

test('permissions UX: incorrect login credentials are explained without a technical error', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Correo electrónico').fill(USERS.admin.email)
  await page.getByLabel('Contraseña', { exact: true }).fill('Incorrect_' + randomBytes(12).toString('hex'))
  const rejected = page.waitForResponse(r => r.url().endsWith('/auth/login') && r.status() === 401)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await rejected
  await expect(page.getByText('Email o contraseña incorrectos.', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Correo electrónico')).toHaveValue(USERS.admin.email)
  expect(await page.locator('body').innerText()).not.toMatch(technical)
  await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(0)
})

test('permissions UX: an ordinary token refresh preserves a draft and saves exactly once', async ({ page, context }) => {
  test.setTimeout(170_000)
  const api = await signIn(page, 'reception')
  await api.reload()
  await page.getByRole('link', { name: 'Clientes', exact: true }).click()
  await page.getByRole('button', { name: '+ Nuevo cliente', exact: true }).click()
  const name = `QA borrador tras renovar ${Date.now()}`
  const phone = uniquePhone()
  await page.getByLabel('Nombre y apellido').fill(name)
  await page.getByLabel('Teléfono / WhatsApp').fill(phone)
  const activeAuthorization = api.headers().Authorization
  const refreshed = page.waitForResponse(r => r.url().endsWith('/auth/refresh') && r.ok(), { timeout: 150_000 })
  await expect.poll(async () => (await context.request.get('/api/v1/customers?take=1', { headers: { Authorization: activeAuthorization } })).status(), { timeout: 130_000, intervals: [1000] }).toBe(401)
  const created = page.waitForResponse(r => r.url().endsWith('/customers') && r.request().method() === 'POST' && r.status() === 201)
  await expect(page.getByLabel('Nombre y apellido')).toHaveValue(name)
  await expect(page.getByLabel('Teléfono / WhatsApp')).toHaveValue(phone)
  await page.getByRole('dialog').getByRole('button', { name: 'Crear cliente', exact: true }).click()
  await refreshed
  const customer: Customer = (await (await created).json()).data
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.getByText('Tu cuenta no tiene permiso para realizar esta acción. Consulta al administrador.', { exact: true })).toHaveCount(0)
  await api.persisted<Customer>(`/customers/${customer.id}`, { fullName: name, phone })
  expect(await api.read<Customer[]>(`/customers?q=${encodeURIComponent(name)}`)).toHaveLength(1)
})
