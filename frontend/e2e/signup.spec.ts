import { expect, test } from './web-fixtures'

// A visitor signs up from the pricing page, works during the trial and picks a plan.
// In development the subscription is activated by the simulated provider (no real charge).
test('a new shop signs up, gets the trial and picks a plan', async ({ page }) => {
  const ownerEmail = `dueno${Date.now()}@example.com`
  await page.goto('/precios')
  await expect(page.getByRole('heading', { name: 'El sistema para tu servicio técnico' })).toBeVisible()
  await expect(page.getByText('Estándar').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/precios.png', fullPage: true })

  await page.getByRole('link', { name: 'Probar gratis' }).click()
  await page.getByLabel('Nombre del taller').fill('Taller E2E')
  await page.getByLabel('Tu nombre').fill('Dueño E2E')
  await page.getByLabel('Correo electrónico').fill(ownerEmail)
  await page.getByLabel('Contraseña').fill('Fixi26')
  await page.getByLabel('País').selectOption('AR')
  await page.getByRole('checkbox').check()
  await page.screenshot({ path: 'test-results/registro.png', fullPage: true })
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click()

  await expect(page.getByText(/Prueba gratis: te quedan 15 días/)).toBeVisible()
  await expect(page.getByText(/Confirma tu correo electrónico/)).toBeVisible()
  await page.screenshot({ path: 'test-results/inicio-prueba.png', fullPage: true })

  const reminders = page.getByRole('complementary', { name: 'Recordatorios de tu cuenta' })
  await expect(reminders.getByRole('link', { name: 'Elegir un plan' })).toBeVisible()
  await expect(reminders.getByRole('button', { name: 'Reenviar enlace' })).toBeVisible()
  await expect(page.getByRole('main').getByText(/Prueba gratis:|Confirma tu correo electrónico/)).toHaveCount(0)
  await expect(reminders).toHaveCSS('position', 'fixed')
  const desktopViewport = page.viewportSize()!
  await page.setViewportSize({ width: 390, height: 844 })
  const bounds = await reminders.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
  await expect(reminders.getByRole('button', { name: 'Cerrar aviso: Confirma tu correo', exact: true })).toBeInViewport()
  await page.screenshot({ path: 'test-results/recordatorios-mobile.png', fullPage: true })
  await page.setViewportSize(desktopViewport)
  await reminders.getByRole('button', { name: 'Cerrar aviso: Prueba gratis', exact: true }).click()
  await expect(page.getByText(/Prueba gratis: te quedan/)).toHaveCount(0)
  await expect(reminders.getByRole('button', { name: 'Reenviar enlace' })).toBeVisible()
  await reminders.getByRole('button', { name: 'Cerrar aviso: Confirma tu correo', exact: true }).press('Enter')
  await expect(reminders).toHaveCount(0)

  // Client-side navigation must not restore a reminder the user already closed.
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Tablero', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tablero del taller' })).toBeVisible()
  await expect(reminders).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Tablero del taller' })).toBeVisible()
  await expect(reminders).toHaveCount(0)

  // A new authenticated entry shows both pending reminders again.
  await page.getByRole('button', { name: 'Dueño E2E · Administrador', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click()
  await expect(page.getByRole('heading', { name: 'Ingresar', exact: true })).toBeVisible()
  await page.getByLabel('Correo electrónico').fill(ownerEmail)
  await page.getByLabel('Contraseña').fill('Fixi26')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await expect(reminders.getByRole('button', { name: 'Cerrar aviso: Prueba gratis', exact: true })).toBeVisible()
  await expect(reminders.getByRole('button', { name: 'Cerrar aviso: Confirma tu correo', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Suscripción' }).first().click()
  await expect(page.getByRole('heading', { name: 'Suscripción' })).toBeVisible()
  await page.screenshot({ path: 'test-results/suscripcion.png', fullPage: true })

  await page.getByRole('button', { name: 'Elegir este plan' }).nth(1).click()
  await expect(page.getByText('Plan actualizado.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Plan actual' })).toBeVisible()
  await expect(page.getByText(/Prueba gratis: te quedan/)).toHaveCount(0)
})

test('signup explains a short password in the form without sending the request', async ({ page }) => {
  let signupRequestMade = false
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/auth/signup')) signupRequestMade = true
  })

  await page.goto('/registro')
  await page.getByLabel('Nombre del taller').fill('Taller E2E')
  await page.getByLabel('Tu nombre').fill('Dueño E2E')
  await page.getByLabel('Correo electrónico').fill(`dueno${Date.now()}@example.com`)
  await page.getByLabel('Contraseña').fill('Ab123')
  await page.getByLabel('País').selectOption('MX')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Crear mi cuenta' }).click()

  await expect(page.getByText('La contraseña debe tener al menos 6 caracteres.')).toBeVisible()
  expect(signupRequestMade).toBe(false)
})
