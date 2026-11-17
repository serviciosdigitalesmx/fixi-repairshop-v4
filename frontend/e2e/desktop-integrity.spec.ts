import { test, expect } from './web-fixtures'
import { signIn, write } from './desktop-support'
import { createOrderViaUi, dismissAccountReminders, uniquePhone } from './helpers'
import type { Customer, Device, RepairOrder, OrderAttachment, OrderNote, DashboardSummary, CashSession, Branch, LoginResponse, ShopSettings, StatusHistoryItem } from '../src/api/types'
import fs from 'node:fs/promises'

const permissions = {
  admin: ['orders.manage', 'orders.work', 'sales', 'inventory.manage', 'reports', 'admin'],
  tech: ['orders.manage', 'orders.work'],
  reception: ['orders.manage', 'orders.work', 'sales'],
  cashier: ['sales'],
} as const

for (const role of ['admin', 'tech', 'reception', 'cashier'] as const) test(`roles: ${role} navigation and real server policies`, async ({ page }) => {
  const api = await signIn(page, role)
  expect([...api.session.permissions].sort()).toEqual([...permissions[role]].sort())
  const nav = page.getByRole('navigation', { name: 'Principal' })
  await expect(nav.getByRole('link', { name: 'Órdenes', exact: true })).toBeVisible()
  const settings = await api.get('/settings/integrations')
  expect(settings.status()).toBe(role === 'admin' ? 200 : 403)
  const reports = await api.get('/reports/inventory')
  expect(reports.status()).toBe(role === 'admin' ? 200 : 403)
  const cash = await api.get('/cash/current')
  expect(cash.status()).toBe(role === 'tech' ? 403 : 200)
  if (role !== 'admin') {
    await expect(nav.getByRole('link', { name: 'Configuración', exact: true })).toHaveCount(0)
    await page.goto('/settings')
    await expect(page.getByText('No tienes permiso para ver esta sección.')).toBeVisible()
  }
  if (role === 'cashier') {
    const rejected = await api.post('/customers', { fullName: 'QA no autorizado', phone: uniquePhone(), documentType: 'None', taxCondition: 'ConsumidorFinal', notificationsOptIn: false })
    expect(rejected.status()).toBe(403)
  }
})

test('session: restore, logout and rejected refresh after logout', async ({ page, context }) => {
  const api = await signIn(page, 'tech')
  await api.reload()
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible()
  await page.getByRole('button', { name: /Técnico · Técnico/ }).click()
  const loggedOut = page.waitForResponse(r => r.url().endsWith('/auth/logout'))
  await page.getByRole('menuitem', { name: 'Cerrar sesión', exact: true }).click()
  expect((await loggedOut).status()).toBe(204)
  await expect(page.getByRole('heading', { name: 'Ingresar', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Ingresar', exact: true })).toBeVisible()
  const rejected = await context.request.post('/api/v1/auth/refresh', { headers: { 'X-RS-Refresh': '1' } })
  expect(rejected.status()).toBe(401)
})

test('customers and devices: persist edits, discard changes, reject invalid IMEI', async ({ page }) => {
  const api = await signIn(page)
  const name = `QA CRM ${Date.now()}`
  const phone = uniquePhone()
  await page.goto('/customers')
  await page.getByRole('button', { name: '+ Nuevo cliente', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Crear cliente', exact: true })).toBeDisabled()
  await page.getByLabel('Nombre y apellido').fill(name)
  await page.getByLabel('Teléfono / WhatsApp').fill(phone)
  const customer = await write<Customer>(page, 'POST', '/customers', () => page.getByRole('dialog').getByRole('button', { name: 'Crear cliente', exact: true }).click())
  await api.persisted<Customer>(`/customers/${customer.id}`, { fullName: name, phone })
  await page.goto(`/customers/${customer.id}`)
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.getByLabel('Nombre y apellido').fill(name + ' editado')
  await write<Customer>(page, 'PUT', `/customers/${customer.id}`, () => page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click())
  await api.persisted<Customer>(`/customers/${customer.id}`, { fullName: name + ' editado' })
  await page.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.getByLabel('Nombre y apellido').fill('QA cambio que debe descartarse')
  let editRequests = 0
  page.on('request', r => { if (r.method() === 'PUT' && r.url().endsWith(`/customers/${customer.id}`)) editRequests++ })
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click()
  await page.getByRole('dialog', { name: 'Descartar cambios' }).getByRole('button', { name: 'Descartar', exact: true }).click()
  await api.persisted<Customer>(`/customers/${customer.id}`, { fullName: name + ' editado' })
  expect(editRequests).toBe(0)
  await page.getByRole('button', { name: '+ Equipo', exact: true }).click()
  await page.getByRole('dialog').getByRole('combobox', { name: /^Marca/ }).fill('Samsung')
  await page.getByRole('dialog').getByRole('textbox', { name: /^Modelo/ }).fill('QA Equipo')
  await page.getByLabel('IMEI', { exact: true }).fill('12345')
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true })).toBeDisabled()
  await expect(page.getByText(/IMEI.*válid|IMEI.*15/).first()).toBeVisible()
  expect((await api.read<Device[]>(`/devices?customerId=${customer.id}`)).length).toBe(0)
  await page.getByLabel('IMEI', { exact: true }).fill('490154203237518')
  const device = await write<Device>(page, 'POST', '/devices', () => page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click())
  await api.persisted<Device>(`/devices/${device.id}`, { customerId: customer.id, brand: 'Samsung', model: 'QA Equipo', imei: '490154203237518' })
  await page.getByRole('listitem').filter({ hasText: 'QA Equipo' }).getByRole('button', { name: 'Editar', exact: true }).click()
  await page.getByRole('dialog').getByRole('textbox', { name: /^Modelo/ }).fill('QA Equipo editado')
  await write<Device>(page, 'PUT', `/devices/${device.id}`, () => page.getByRole('dialog').getByRole('button', { name: 'Guardar', exact: true }).click())
  await api.persisted<Device>(`/devices/${device.id}`, { model: 'QA Equipo editado' })
})

test('orders: assignment, reassignment, diagnosis, notes and original/WebP photographs', async ({ page, context }) => {
  const api = await signIn(page)
  const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/orders'))
  await createOrderViaUi(page, `QA diagnóstico ${Date.now()}`)
  const order: RepairOrder = (await (await created).json()).data
  await api.persisted<RepairOrder>(`/orders/${order.id}`, { status: 'Received' })
  const technicians = await api.read<{ id: string; displayName: string }[]>('/users/assignable')
  expect(technicians.length).toBeGreaterThanOrEqual(2)
  for (const technician of technicians.slice(0, 2)) {
    await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Plan de trabajo', exact: true }) }).getByRole('button', { name: 'Editar', exact: true }).click()
    await page.getByRole('dialog', { name: 'Plan de trabajo' }).getByLabel('Técnico', { exact: true }).selectOption(technician.id)
    await write<RepairOrder>(page, 'PUT', `/orders/${order.id}/plan`, () => page.getByRole('dialog', { name: 'Plan de trabajo' }).getByRole('button', { name: 'Guardar', exact: true }).click())
    await api.persisted<RepairOrder>(`/orders/${order.id}`, { assignedTechnicianId: technician.id })
  }
  await page.getByRole('button', { name: 'En diagnóstico', exact: true }).click()
  await write(page, 'POST', `/orders/${order.id}/status`, () => page.getByRole('button', { name: 'Confirmar', exact: true }).click())
  await page.getByRole('button', { name: 'Listo', exact: true }).click()
  await api.persisted<RepairOrder>(`/orders/${order.id}`, { status: 'Diagnosing' })
  const history = await api.read<StatusHistoryItem[]>(`/orders/${order.id}/history`)
  expect(history.some(item => item.toStatus === 'Diagnosing')).toBeTruthy()
  await page.getByRole('tab', { name: /^Notas/ }).click()
  const body = `QA nota interna ${Date.now()}`
  await page.getByRole('textbox', { name: 'Nueva nota', exact: true }).fill(body)
  await write<OrderNote>(page, 'POST', `/orders/${order.id}/notes`, () => page.getByRole('button', { name: 'Agregar nota', exact: true }).dblclick())
  await api.reload()
  expect((await api.read<OrderNote[]>(`/orders/${order.id}/notes`)).filter(note => note.body === body)).toHaveLength(1)
  await expect(page.getByText(body, { exact: true })).toBeVisible()
  await page.getByRole('tab', { name: /^Fotos/ }).click()
  const image = await page.screenshot({ type: 'png' })
  const attachment = await write<OrderAttachment>(page, 'POST', `/orders/${order.id}/attachments/upload`, () => page.locator('input[type=file]').setInputFiles({ name: 'qa-desktop.png', mimeType: 'image/png', buffer: image }))
  await api.reload()
  const stored = (await api.read<OrderAttachment[]>(`/orders/${order.id}/attachments`)).find(item => item.id === attachment.id)
  expect(stored?.fileName).toBe('qa-desktop.png')
  expect(stored?.thumbnailUrl).toBeTruthy()
  const original = await context.request.get(attachment.url!)
  expect(original.status()).toBe(200)
  expect(original.headers()['content-type']).toContain('image/png')
  expect(await original.body()).toEqual(image)
  const thumbnail = await context.request.get(stored!.thumbnailUrl!)
  expect(thumbnail.status()).toBe(200)
  expect(thumbnail.headers()['content-type']).toContain('image/webp')
  await page.getByRole('tab', { name: /^Fotos/ }).click()
  const photograph = page.getByRole('img', { name: attachment.label ?? 'Foto de la orden', exact: true })
  await expect(photograph).toBeVisible()
  await expect.poll(() => photograph.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const rejected = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/attachments/upload'))
  await page.locator('input[type=file]').setInputFiles({ name: 'qa-invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') })
  expect((await rejected).status()).toBe(400)
  await api.reload()
  expect(await api.read<OrderAttachment[]>(`/orders/${order.id}/attachments`)).toHaveLength(1)
})

test('dashboard: persisted order totals, statuses, board and filters agree', async ({ page }) => {
  const api = await signIn(page)
  const summary = await api.read<DashboardSummary>('/dashboard/summary')
  const orders = await api.read<RepairOrder[]>('/orders?take=200')
  expect(orders.length).toBe(summary.totalOrders)
  expect(orders.filter(order => !['Delivered', 'Cancelled'].includes(order.status))).toHaveLength(summary.openOrders)
  expect(orders.filter(order => order.status === 'Ready')).toHaveLength(summary.readyOrders)
  for (const [status, count] of Object.entries(summary.statusCounts ?? {})) expect(orders.filter(order => order.status === status)).toHaveLength(count)
  await expect(page.getByRole('button', { name: /^Órdenes abiertas/ }).locator('.fx-metric-value')).toHaveText(String(summary.openOrders))
  await page.getByRole('link', { name: 'Tablero', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tablero del taller' })).toBeVisible()
  const board = await api.read<{ columns: { status: string; count: number; items: { id: string }[] }[] }>('/orders/board')
  for (const column of board.columns) expect(column.items.length).toBe(orders.filter(order => order.status === column.status).length)
  await page.goto('/orders?status=Received')
  const filtered = await api.read<RepairOrder[]>('/orders?status=Received&take=200')
  expect(filtered.every(order => order.status === 'Received')).toBeTruthy()
  const order = orders[0]
  await page.goto(`/orders?q=${encodeURIComponent(order.code)}`)
  await expect(page.getByRole('link', { name: order.code, exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('link', { name: order.code, exact: true })).toBeVisible()
})

test('tenants and branches: session switch, cross-tenant denial and persisted branch', async ({ page, request }) => {
  const api = await signIn(page)
  const foreign = await request.post('/api/v1/auth/signup', { data: { shopName: 'QA tenant aislado', ownerName: 'QA Owner', email: `qa-${Date.now()}@example.invalid`, password: 'QA_Web_2026!', country: 'MX', timeZone: 'America/Mexico_City', acceptTerms: true } })
  expect(foreign.status()).toBe(200)
  const other: LoginResponse = (await foreign.json()).data
  const foreignName = `QA cliente otro tenant ${Date.now()}`
  const foreignHeaders = { Authorization: `Bearer ${other.accessToken}` }
  const foreignWrite = await request.post('/api/v1/customers', { headers: foreignHeaders, data: { fullName: foreignName, phone: uniquePhone(), documentType: 'None', taxCondition: 'ConsumidorFinal', notificationsOptIn: false } })
  expect(foreignWrite.status()).toBe(201)
  const foreignCustomer: Customer = (await foreignWrite.json()).data
  expect((await request.get(`/api/v1/customers/${foreignCustomer.id}`, { headers: foreignHeaders })).status()).toBe(200)
  expect((await api.get(`/customers/${foreignCustomer.id}`)).status()).toBe(404)
  await page.goto(`/customers?q=${encodeURIComponent(foreignName)}`)
  await expect(page.getByText('Sin resultados', { exact: true })).toBeVisible()
  const switchedForeign = await api.post('/auth/switch-shop', { shopId: other.user.shopId })
  expect(switchedForeign.status()).toBe(403)
  expect((await api.read<{ user: { shopId: string } }>('/auth/me')).user.shopId).toBe(api.session.user.shopId)
  await page.goto('/settings?tab=branches')
  await page.getByRole('button', { name: '+ Nueva sucursal', exact: true }).click()
  const name = `QA Sucursal ${Date.now()}`
  await page.getByRole('dialog').getByRole('textbox', { name: /^Nombre/ }).fill(name)
  const branch = await write<Branch>(page, 'POST', '/settings/branches', () => page.getByRole('button', { name: 'Crear sucursal', exact: true }).click())
  await expect(page.getByRole('combobox', { name: 'Cambiar de sucursal', exact: true }).getByRole('option', { name, exact: true })).toBeAttached()
  await api.reload()
  expect((await api.read<Branch[]>('/settings/branches')).some(b => b.id === branch.id && b.name === name)).toBeTruthy()
  const switchResponse = page.waitForResponse(r => r.url().endsWith('/auth/switch-shop') && r.ok())
  const branchDashboard = page.waitForResponse(r => r.url().endsWith('/dashboard/summary') && r.ok())
  await page.getByRole('combobox', { name: 'Cambiar de sucursal', exact: true }).selectOption(branch.id)
  expect((await (await switchResponse).json()).data.user.shopId).toBe(branch.id)
  expect((await (await branchDashboard).json()).data.shopId).toBe(branch.id)
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Cambiar de sucursal', exact: true })).toHaveValue(branch.id)
  const back = page.waitForResponse(r => r.url().endsWith('/auth/switch-shop') && r.ok())
  await page.getByRole('combobox', { name: 'Cambiar de sucursal', exact: true }).selectOption(api.session.user.shopId)
  expect((await (await back).json()).data.user.shopId).toBe(api.session.user.shopId)
  await dismissAccountReminders(page)
})

test('timezone: valid Argentina and Mexico zones persist; invalid IANA value is rejected', async ({ page }) => {
  const api = await signIn(page)
  const before = await api.read<ShopSettings>('/settings')
  await page.goto('/settings?tab=general')
  for (const zone of ['America/Mexico_City', 'America/Argentina/Buenos_Aires']) {
    await page.getByLabel('Zona horaria', { exact: true }).selectOption(zone)
    await write(page, 'PUT', '/settings', () => page.getByRole('button', { name: 'Guardar cambios', exact: true }).click())
    await api.persisted<ShopSettings>('/settings', { timeZone: zone })
    await expect(page.getByLabel('Zona horaria', { exact: true })).toHaveValue(zone)
  }
  const invalid = await api.put('/settings', { ...before, timeZone: 'QA/Invalid_Time_Zone' })
  expect(invalid.status()).toBe(400)
  expect((await invalid.json()).detail).toContain('Zona horaria inválida')
  await api.persisted<ShopSettings>('/settings', { timeZone: 'America/Argentina/Buenos_Aires' })
})

test('network: offline form survives and repeated save creates one real customer', async ({ page, context }) => {
  const api = await signIn(page)
  await page.goto('/customers')
  await page.getByRole('button', { name: '+ Nuevo cliente', exact: true }).click()
  const name = `QA red ${Date.now()}`
  await page.getByLabel('Nombre y apellido').fill(name)
  await page.getByLabel('Teléfono / WhatsApp').fill(uniquePhone())
  await context.setOffline(true)
  await page.getByRole('dialog').getByRole('button', { name: 'Crear cliente', exact: true }).click()
  await expect(page.getByText(/No se pudo conectar con el servidor/)).toBeVisible()
  await expect(page.getByLabel('Nombre y apellido')).toHaveValue(name)
  await context.setOffline(false)
  const customer = await write<Customer>(page, 'POST', '/customers', () => page.getByRole('dialog').getByRole('button', { name: 'Crear cliente', exact: true }).dblclick())
  await api.persisted<Customer>(`/customers/${customer.id}`, { fullName: name })
  expect(await api.read<Customer[]>(`/customers?q=${encodeURIComponent(name)}`)).toHaveLength(1)
})

test('reports: real spreadsheet downloads and intake/label PDFs', async ({ page }) => {
  test.setTimeout(150_000)
  const api = await signIn(page)
  for (const report of ['revenue', 'margins', 'repair-times', 'quotes', 'top-issues', 'technicians', 'warranty', 'feedback', 'inventory']) {
    await page.goto(`/reports?r=${report}`)
    await expect(page.getByRole('heading', { name: 'Reportes', exact: true })).toBeVisible()
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar a Excel', exact: true }).click()
    const download = await downloading
    expect(await download.failure()).toBeNull()
    const data = await fs.readFile((await download.path())!)
    expect(data.subarray(0, 2).toString()).toBe('PK')
    expect(data.length).toBeGreaterThan(100)
  }
  const orders = await api.read<RepairOrder[]>('/orders?take=1')
  expect(orders.length).toBe(1)
  for (const document of ['intake', 'label']) {
    const response = await api.get(`/orders/${orders[0].id}/documents/${document}`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/pdf')
    expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-')
  }
})

test('cash expenses: actual movement, persisted amount and register reconciliation', async ({ page }) => {
  const api = await signIn(page)
  await page.goto('/cash')
  let session = await api.read<CashSession | null>('/cash/current')
  if (!session) {
    await page.getByLabel('Efectivo inicial (cambio)').fill('1000')
    session = await write<CashSession>(page, 'POST', '/cash/open', () => page.getByRole('button', { name: 'Abrir caja', exact: true }).click())
    await api.persisted<CashSession>(`/cash/sessions/${session.id}`, { status: 'Open', openingCash: 1000 })
  }
  const description = `QA gasto ${Date.now()}`
  const before = await api.read<CashSession>('/cash/current')
  await page.getByRole('button', { name: '− Gasto', exact: true }).click()
  await page.getByRole('dialog', { name: 'Registrar gasto' }).getByLabel('Monto').fill('25')
  await page.getByRole('dialog', { name: 'Registrar gasto' }).getByLabel('Descripción').fill(description)
  await write(page, 'POST', '/cash/movements', () => page.getByRole('dialog', { name: 'Registrar gasto' }).getByRole('button', { name: 'Guardar', exact: true }).click())
  await api.reload()
  const after = await api.read<CashSession>('/cash/current')
  const movement = after.movements?.find(m => m.description === description)
  expect(movement?.signedAmount).toBe(-25)
  expect(movement?.type).toBe('Expense')
  expect(after.summary.find(s => s.method === 'Cash')!.expected).toBe((before.summary.find(s => s.method === 'Cash')?.expected ?? before.openingCash) - 25)
  await expect(page.getByText(description, { exact: true })).toBeVisible()
})

test('session expiry: real JWT expiration refreshes and retries the protected request', async ({ page, context }) => {
  test.setTimeout(160_000)
  const api = await signIn(page, 'reception')
  const original = api.session.accessToken
  const denied = page.waitForResponse(r => r.url().includes('/api/v1/') && !r.url().includes('/auth/') && r.status() === 401, { timeout: 150_000 })
  const refresh = page.waitForResponse(r => r.url().endsWith('/auth/refresh') && r.ok(), { timeout: 150_000 })
  await expect.poll(async () => (await context.request.get('/api/v1/customers?take=1', { headers: { Authorization: `Bearer ${original}` } })).status(), { timeout: 130_000, intervals: [1000] }).toBe(401)
  const retried = page.waitForResponse(r => r.url().includes('/customers?') && r.ok())
  await page.getByRole('link', { name: 'Clientes', exact: true }).click()
  await denied
  expect((await (await refresh).json()).data.accessToken).not.toBe(original)
  expect((await retried).status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible()
})
