import { test, expect } from './web-fixtures'
import { login, uniquePhone } from './helpers'
import type { LoginResponse, RepairOrder } from '../src/api/types'

test('desktop smoke: real login, reception, reload and persisted API state', async ({ page, context }) => {
  const loggedIn = page.waitForResponse(r => r.url().endsWith('/auth/login') && r.ok())
  await login(page, 'reception')
  const session: LoginResponse = (await (await loggedIn).json()).data
  const headers = { Authorization: `Bearer ${session.accessToken}` }
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeVisible()
  await page.getByRole('link', { name: 'Recibir equipo', exact: true }).click()
  await page.getByRole('button', { name: '+ Cliente nuevo', exact: true }).click()
  const name = `QA Web ${Date.now()}`
  const phone = uniquePhone()
  await page.getByLabel('Nombre y apellido').fill(name)
  await page.getByLabel('Teléfono / WhatsApp').fill(phone)
  const customerWrite = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/customers'))
  await page.getByRole('button', { name: 'Crear cliente y seguir', exact: true }).click()
  const customerResponse = await customerWrite
  expect(customerResponse.ok()).toBeTruthy()
  const customer = (await customerResponse.json()).data
  const persistedCustomer = await context.request.get(`/api/v1/customers/${customer.id}`, { headers })
  expect(persistedCustomer.ok()).toBeTruthy()
  expect((await persistedCustomer.json()).data).toMatchObject({ fullName: name, phone })
  await page.reload()
  await page.goto(`/orders/new?customerId=${customer.id}`)
  await page.getByRole('combobox', { name: /^Marca/ }).fill('Samsung')
  await page.getByRole('textbox', { name: /^Modelo/ }).fill('QA Web Desktop')
  const deviceWrite = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/devices'))
  await page.getByRole('button', { name: 'Agregar equipo y seguir', exact: true }).click()
  const deviceResponse = await deviceWrite
  expect(deviceResponse.ok()).toBeTruthy()
  const device = (await deviceResponse.json()).data
  const persistedDevice = await context.request.get(`/api/v1/devices/${device.id}`, { headers })
  expect(persistedDevice.ok()).toBeTruthy()
  expect((await persistedDevice.json()).data).toMatchObject({ customerId: customer.id, brand: 'Samsung', model: 'QA Web Desktop' })
  const issue = `QA pantalla sin imagen ${Date.now()}`
  await page.getByLabel('Falla que reporta el cliente').fill(issue)
  const orderWrite = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/orders'))
  await page.getByRole('button', { name: 'Crear orden', exact: true }).click()
  const orderResponse = await orderWrite
  expect(orderResponse.ok()).toBeTruthy()
  const order: RepairOrder = (await orderResponse.json()).data
  await page.getByRole('button', { name: 'Ver orden', exact: true }).click()
  await expect(page.getByRole('heading', { name: new RegExp(order.code) })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: new RegExp(order.code) })).toBeVisible()
  const persistedOrder = await context.request.get(`/api/v1/orders/${order.id}`, { headers })
  expect(persistedOrder.ok()).toBeTruthy()
  expect((await persistedOrder.json()).data).toMatchObject({ customerId: customer.id, deviceId: device.id, issueDescription: issue, status: 'Received' })
  await expect(page.getByText(issue, { exact: true })).toBeVisible()
})
