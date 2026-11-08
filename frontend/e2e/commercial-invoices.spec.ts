import { expect, test } from '@playwright/test'

test('Mexico commercial invoice: issue, inspect, cancel and reissue with a new folio', async ({ page, request }) => {
  test.setTimeout(120_000)
  const email = `invoice-${Date.now()}@example.com`
  const password = 'InvoiceTest12345'
  const signup = await request.post('/api/v1/auth/signup', { data: { shopName: 'Taller comercial E2E', ownerName: 'Cliente E2E', email, password, country: 'MX', timeZone: 'America/Mexico_City', acceptTerms: true } })
  expect(signup.ok()).toBeTruthy()
  const session = (await signup.json()).data
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const customer = (await (await request.post('/api/v1/customers', { headers, data: { fullName: 'Cliente E2E', phone: `551${Date.now().toString().slice(-7)}` } })).json()).data
  const device = (await (await request.post('/api/v1/devices', { headers, data: { customerId: customer.id, brand: 'Samsung', model: 'Prueba' } })).json()).data
  const order = (await (await request.post('/api/v1/orders', { headers, data: { customerId: customer.id, deviceId: device.id, issueDescription: 'Pantalla dañada' } })).json()).data
  expect((await request.put(`/api/v1/orders/${order.id}/quote`, { headers, data: { amount: 500, currency: 'MXN' } })).ok()).toBeTruthy()
  await page.goto('/login')
  await page.getByLabel('Correo electrónico').fill(email)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(page).not.toHaveURL(/login/)
  await page.goto(`/orders/${order.id}?tab=payments`)
  await page.getByRole('button', { name: 'Emitir factura comercial', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Documento comercial sin validez fiscal. No constituye un CFDI')
  await expect(page.getByRole('dialog')).toContainText('FC-1')
  const downloading = page.waitForEvent('download', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Descargar PDF', exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/factura-comercial-.*\.pdf/)
  expect(await download.failure()).toBeNull()
  await page.getByLabel('Motivo de cancelación administrativa').fill('Corrección administrativa E2E')
  await page.getByRole('button', { name: 'Cancelar documento', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Cancelada: Corrección administrativa E2E')
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).last().click()
  await page.getByRole('button', { name: 'Emitir factura comercial', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('FC-2')
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).last().click()
  await page.goto('/invoices')
  await expect(page.getByText('FC-000001', { exact: true })).toBeVisible()
  await expect(page.getByText('FC-000002', { exact: true })).toBeVisible()
  await page.goto('/settings?tab=integrations')
  await expect(page.getByText('ARCA (ex AFIP)')).toHaveCount(0)
})
