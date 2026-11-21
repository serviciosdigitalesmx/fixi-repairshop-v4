import { test, expect, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'

// Real UI -> existing JWT/refresh authentication -> ASP.NET -> isolated PostgreSQL.
// Never record authentication requests, passwords, cookies or response tokens in traces.
test.use({ trace: 'off', video: 'off', actionTimeout: 15_000, navigationTimeout: 30_000, locale: 'es-MX', timezoneId: 'America/Mexico_City' })
const email = process.env.E2E_SUPERADMIN_EMAIL
const password = process.env.E2E_SUPERADMIN_PASSWORD
test.skip(!email || !password, 'Set E2E_SUPERADMIN_EMAIL/PASSWORD for an explicitly granted owner in isolated QA.')
test.beforeAll(() => {
  const host = process.env.E2E_BASE_URL ? new URL(process.env.E2E_BASE_URL).hostname : ''
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new Error('Command Center mutation tests require an isolated loopback QA environment.')
})

async function login(page: Page, account = email!, secret = password!) {
  await page.goto('/admin')
  await page.getByLabel('Correo electrónico', { exact: true }).fill(account)
  await page.getByLabel('Contraseña', { exact: true }).fill(secret)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
}
async function save(page: Page, path: string, method = 'POST') {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/v1${path}` && r.request().method() === method)
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar y guardar' }).click()
  const result = await response
  expect(result.status(), await result.text()).toBe(200)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  return (await result.json()).data
}

test('anonymous and tenant administrator cannot enter any global screen', async ({ page, request }) => {
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Ingresar', exact: true })).toBeVisible()
  const account = `tenant-${randomBytes(8).toString('hex')}@example.test`
  const secret = `Qa_${randomBytes(16).toString('hex')}`
  const signup = await request.post('/api/v1/auth/signup', { data: { shopName: 'Tenant authorization QA', ownerName: 'Tenant owner', email: account, password: secret, country: 'MX', acceptTerms: true } })
  expect(signup.status()).toBe(200)
  const session = (await signup.json()).data
  expect(session.user.isSuperAdmin).toBe(false)
  await login(page, account, secret)
  await expect(page.getByRole('heading', { name: 'Acceso exclusivo del propietario de Fixi' })).toBeVisible()
  for (const path of ['/admin', '/admin/shops', '/admin/users', '/admin/plans', '/admin/subscriptions', '/admin/audit']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Acceso exclusivo del propietario de Fixi' })).toBeVisible()
    const denied = await request.get(`/api/v1${path}`, { headers: { Authorization: `Bearer ${session.accessToken}` } })
    // /admin is a frontend index, the backend index lives at /admin/dashboard.
    if (path !== '/admin') expect(denied.status()).toBe(403)
  }
})

test('owner completes global operations with persisted data, audit, theme and mobile navigation', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  const failures: string[] = []
  page.on('pageerror', e => failures.push(e.message))
  page.on('response', r => { if (r.status() >= 400 && new URL(r.url()).pathname.startsWith('/api/')) failures.push(`${r.status()} ${new URL(r.url()).pathname}`) })
  await login(page)
  await expect(page.getByRole('heading', { name: 'Tu plataforma, en perspectiva.' })).toBeVisible()
  await expect(page.getByText('Talleres registrados', { exact: true })).toBeVisible()
  await expect(page.getByText('Ingresos recurrentes contratados (MRR)', { exact: true })).toBeVisible()
  await expect(page.getByText(/Última consulta:/)).toBeVisible()
  await expect(page.getByRole('img', { name: 'Gráfica de altas mensuales' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('command-dashboard-light.png'), fullPage: true })

  const suffix = randomBytes(5).toString('hex')
  const shopName = `QA Command ${suffix}`
  await page.getByRole('link', { name: 'Talleres', exact: true }).click()
  await page.getByRole('button', { name: '+ Registrar taller', exact: true }).click()
  await page.getByLabel(/^Nombre del taller\s*\*?$/).fill(shopName)
  await page.getByLabel(/^Nombre del propietario\s*\*?$/).fill('Propietario del taller QA')
  await page.getByLabel(/^Correo del propietario\s*\*?$/).fill(`shop-${suffix}@example.test`)
  const shop = await save(page, '/admin/shops')
  await page.reload()
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(shopName)
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: shopName, exact: true }) })
  await expect(row).toBeVisible()
  await expect(row).toContainText('En prueba')
  await row.getByRole('button', { name: 'Suspender', exact: true }).click()
  await page.getByLabel('Motivo del cambio').fill('Suspensión verificada desde QA aislado')
  await save(page, `/admin/shops/${shop.id}/activation`)
  await page.reload()
  await expect(row).toContainText('Organización suspendida')
  await row.getByRole('button', { name: 'Reactivar', exact: true }).click()
  await page.getByLabel('Motivo del cambio').fill('Reactivación verificada desde QA aislado')
  await save(page, `/admin/shops/${shop.id}/activation`)
  await page.reload()
  await expect(row.getByRole('button', { name: 'Suspender' })).toBeVisible()
  await row.getByRole('link', { name: shopName }).click()
  await expect(page.getByRole('heading', { name: 'Sucursales de la organización' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: shopName, exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Usuarios', exact: true }).click()
  await page.getByRole('button', { name: '+ Invitar usuario' }).click()
  await page.getByLabel(/^Nombre\s*\*?$/).fill('Técnico QA')
  const invitedEmail = `tech-${suffix}@example.test`
  await page.getByLabel(/^Correo\s*\*?$/).fill(invitedEmail)
  await page.getByLabel('Buscar taller de destino', { exact: true }).fill(shopName)
  await expect(page.getByLabel(/^Taller de destino\s*\*?$/).getByRole('option', { name: shopName })).toHaveCount(1)
  await page.getByLabel(/^Taller de destino\s*\*?$/).selectOption(shop.id)
  const invited = await save(page, '/admin/users')
  await page.reload()
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(invitedEmail)
  const userRow = page.getByRole('row').filter({ hasText: invitedEmail })
  await expect(userRow).toContainText('Invitación pendiente')
  await userRow.getByRole('button', { name: 'Editar', exact: true }).click()
  await page.getByLabel('Rol del taller principal').selectOption('Reception')
  await page.getByLabel('Motivo del cambio').fill('Reasignación de rol para comprobar persistencia')
  await save(page, `/admin/users/${invited.id}`, 'PUT')
  await page.reload()
  await expect(userRow).toContainText('Recepción')

  await page.getByRole('link', { name: 'Suscripciones', exact: true }).click()
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill(shopName)
  const subRow = page.getByRole('row').filter({ has: page.getByRole('link', { name: shopName, exact: true }) })
  await subRow.getByRole('button', { name: 'Gestionar' }).click()
  await page.getByLabel(/^Operación\s*\*?$/).selectOption('complimentary')
  await page.getByLabel('Plan (cambio local o bonificación)').selectOption('Standard')
  await page.getByLabel('Motivo del cambio').fill('Bonificación real en organización aislada QA')
  await save(page, `/admin/subscriptions/${shop.organizationId}`)
  await page.reload()
  await expect(subRow).toContainText('Bonificada')
  await expect(subRow).toContainText('Estándar')
  await subRow.getByRole('button', { name: 'Gestionar' }).click()
  await page.getByLabel(/^Operación\s*\*?$/).selectOption('trial')
  await page.getByLabel('Motivo del cambio').fill('Verificación de prueba Pro de quince días')
  await save(page, `/admin/subscriptions/${shop.organizationId}`)
  await page.reload()
  await expect(subRow).toContainText('En prueba')
  await expect(subRow).toContainText('Profesional')

  await page.getByRole('link', { name: 'Planes', exact: true }).click()
  const basic = page.locator('[data-slot="card"]').filter({ has: page.getByRole('heading', { name: 'Básico', exact: true }) })
  await basic.getByRole('button', { name: 'Editar precio MXN' }).click()
  const current = Number(await page.getByLabel('Precio mensual MXN').inputValue())
  const price = Number((current + 1.25).toFixed(2))
  await page.getByLabel('Precio mensual MXN').fill(String(price))
  await page.getByLabel('Motivo del cambio').fill('Verificación del catálogo persistido en PostgreSQL QA')
  await save(page, '/admin/plans/Basic', 'PUT')
  await page.reload()
  await basic.getByRole('button', { name: 'Editar precio MXN' }).click()
  await expect(page.getByLabel('Precio mensual MXN')).toHaveValue(String(price))
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click()

  await page.getByRole('link', { name: 'Auditoría', exact: true }).click()
  await page.getByRole('textbox', { name: 'Buscar registros' }).fill('platform_price_changed')
  await expect(page.getByRole('cell', { name: 'platform_price_changed', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Usar modo oscuro', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('link', { name: 'Vista general', exact: true }).click()
  await expect(page.getByText(/Última consulta:/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('command-dashboard-dark.png'), fullPage: true })
  await page.goto('/settings?tab=users')
  const protectedAccount = page.getByRole('row').filter({ hasText: email! })
  await expect(protectedAccount).toContainText('Cuenta global · gestión en servidor')
  await protectedAccount.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('link', { name: 'FIXI Command Center', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tu plataforma, en perspectiva.' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Abrir navegación' }).click()
  await page.getByRole('link', { name: 'Talleres', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Directorio de talleres' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('command-mobile.png'), fullPage: true })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('heading', { name: 'Directorio de talleres' })).toBeVisible()
  expect(failures).toEqual([])
})
