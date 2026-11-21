import { test, expect } from '@playwright/test'
import { randomBytes } from 'node:crypto'

test.use({ trace: 'off', video: 'off', actionTimeout: 15_000, locale: 'es-MX', timezoneId: 'America/Mexico_City' })

// This case never invokes checkout or a simulated billing gateway. The trial is persisted by the real API.
test('Mexican public signup preserves a fifteen-day Pro trial after reload without granting global access', async ({ page, baseURL, request }) => {
  if (!baseURL || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname))
    throw new Error('Trial registration requires isolated loopback QA.')
  await page.goto('/registro')
  await page.getByLabel('Nombre del taller').fill('Prueba de registro mexicano')
  await page.getByLabel('Tu nombre').fill('Propietario de prueba')
  await page.getByLabel('Correo electrónico').fill(`trial-${randomBytes(8).toString('hex')}@example.test`)
  await page.getByLabel('Contraseña').fill(`Qa_${randomBytes(16).toString('hex')}`)
  await page.getByLabel('País').selectOption('MX')
  await page.getByRole('checkbox').check()
  const created = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/auth/signup' && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click()
  const response = await created
  expect(response.status()).toBe(200)
  const session = (await response.json()).data
  expect(session.user.isSuperAdmin).toBe(false)
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  const billing = await request.get('/api/v1/billing/subscription', { headers })
  expect(billing.status()).toBe(200)
  const original = (await billing.json()).data
  expect(original.plan).toBe('Pro')
  expect(original.status).toBe('Trialing')
  expect(original.trialDaysLeft).toBe(15)
  expect((Date.parse(original.trialEndsAtUtc) - Date.now()) / 86_400_000).toBeGreaterThan(14.99)
  expect((Date.parse(original.trialEndsAtUtc) - Date.now()) / 86_400_000).toBeLessThanOrEqual(15)
  await expect(page.getByText(/Prueba gratis: te quedan 15 días/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Prueba gratis: te quedan 15 días/)).toBeVisible()
  const persisted = await request.get('/api/v1/billing/subscription', { headers })
  expect(persisted.status()).toBe(200)
  expect((await persisted.json()).data.trialEndsAtUtc).toBe(original.trialEndsAtUtc)
  expect((await request.get('/api/v1/admin/access', { headers })).status()).toBe(403)
})
