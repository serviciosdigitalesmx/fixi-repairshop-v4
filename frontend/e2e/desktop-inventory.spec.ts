import { test, expect } from './web-fixtures'
import { signIn, write } from './desktop-support'
import { createOrderViaUi } from './helpers'
import type { InventoryItem, PartUsage, RepairOrder } from '../src/api/types'

test('inventory: stock adjustment and real part consumption persist and reconcile', async ({ page }) => {
  const api = await signIn(page)
  const sku = `QA-STOCK-${Date.now()}`
  await page.goto('/inventory')
  await page.getByRole('button', { name: '+ Nuevo producto', exact: true }).click()
  await page.getByRole('dialog').getByLabel('SKU', { exact: false }).fill(sku)
  await page.getByRole('dialog').getByLabel('Nombre', { exact: false }).fill(`QA refacción ${sku}`)
  await page.getByLabel('Stock inicial', { exact: true }).fill('5')
  await page.getByLabel('Stock mínimo', { exact: true }).fill('2')
  await page.getByLabel('Costo unitario', { exact: true }).fill('100')
  const item = await write<InventoryItem>(page, 'POST', '/inventory', () => page.getByRole('button', { name: 'Crear producto', exact: true }).click())
  await api.persisted<InventoryItem>(`/inventory/${item.id}`, { sku, quantityOnHand: 5 })
  await page.getByPlaceholder(/Buscar por nombre, SKU/).fill(sku)
  await page.getByRole('row', { name: new RegExp(sku) }).click()
  await page.getByRole('button', { name: 'Ajustar stock', exact: true }).click()
  await page.getByRole('dialog', { name: 'Ajustar stock', exact: true }).getByLabel('Cantidad que ingresa', { exact: true }).fill('3')
  await write<InventoryItem>(page, 'POST', `/inventory/${item.id}/adjustments`, () => page.getByRole('dialog', { name: 'Ajustar stock', exact: true }).getByRole('button', { name: 'Guardar', exact: true }).click())
  await api.persisted<InventoryItem>(`/inventory/${item.id}`, { quantityOnHand: 8, availableQuantity: 8 })
  const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/orders'))
  await createOrderViaUi(page, `QA consumo de refacción ${Date.now()}`)
  const order: RepairOrder = (await (await created).json()).data
  await page.getByRole('tab', { name: /^Refacciones/ }).click()
  await page.getByRole('checkbox', { name: /^Solo compatibles/ }).uncheck()
  await page.getByPlaceholder('Buscar refacción por nombre, SKU o código…', { exact: true }).fill(sku)
  await page.getByRole('button', { name: new RegExp(sku) }).click()
  await page.getByLabel('Cantidad', { exact: true }).fill('2')
  await write<PartUsage[]>(page, 'POST', `/orders/${order.id}/parts`, () => page.getByRole('button', { name: 'Descontar del inventario', exact: true }).click())
  await api.reload()
  const stock = await api.read<InventoryItem>(`/inventory/${item.id}`)
  expect(stock.quantityOnHand).toBe(6)
  expect(stock.availableQuantity).toBe(6)
  const usages = await api.read<PartUsage[]>(`/orders/${order.id}/parts`)
  expect(usages.filter(p => p.inventoryItemId === item.id)).toHaveLength(1)
  expect(usages.find(p => p.inventoryItemId === item.id)?.quantityUsed).toBe(2)
  await expect(page.getByRole('cell', { name: new RegExp(sku) })).toBeVisible()
})
