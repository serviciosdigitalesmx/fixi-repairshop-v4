import { test as base, expect, type BrowserContext, type Page, type Response } from '@playwright/test'
import fs from 'node:fs/promises'
import type { LoginResponse } from '../src/api/types'

export type { Page } from '@playwright/test'

// Ignore responses belonging to the page that is being replaced, and wait for a complete body.
export async function completedResponse(response: Response): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return (await Promise.race([response.finished(), new Promise<Error>(resolve => {
      timer = setTimeout(() => resolve(new Error('Response did not complete within 10 seconds')), 10_000)
    })])) === null
  } catch { return false } finally { clearTimeout(timer) }
}
export async function reloadAuthenticated(page: Page): Promise<LoginResponse> {
  const started = Date.now()
  const restored = page.waitForResponse(async response => response.url().endsWith('/auth/refresh') && response.ok()
    && response.request().timing().startTime >= started && await completedResponse(response))
  await page.reload()
  return (await (await restored).json()).data as LoginResponse
}

type Mutation = { method: string; path: string; resource?: string; id?: string; expected?: Record<string, unknown>; authorization?: string; result?: string }
const observedWrites = new WeakMap<BrowserContext, Mutation[]>()
export function recordExternalMutation(page: Page, path: string, body: unknown) {
  observedWrites.get(page.context())?.push({ method: 'POST', path, ...resourceFor(path, body) })
}
function resourceFor(path: string, body: unknown): Pick<Mutation, 'resource' | 'id' | 'expected'> {
  if (!body || typeof body !== 'object') return {}
  let data = (body as { data?: unknown }).data
  if (data && typeof data === 'object' && 'quote' in data) data = (data as { quote: unknown }).quote
  else if (data && typeof data === 'object' && 'order' in data) data = (data as { order: unknown }).order
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const expected = data as Record<string, unknown>
  if (/^\/orders\/[^/]+\/status$/.test(path) && typeof expected.orderId === 'string' && typeof expected.toStatus === 'string') {
    return { resource: `/orders/${expected.orderId}`, expected: { id: expected.orderId, status: expected.toStatus } }
  }
  const id = typeof expected.id === 'string' ? expected.id : undefined
  if (path === '/settings') return { resource: '/settings', expected }
  if (/^\/orders\/[^/]+\/(checklist|qa)$/.test(path)) return { resource: path, expected }
  if (path === '/users' && expected.user && typeof expected.user === 'object') {
    const user = expected.user as Record<string, unknown>
    return { resource: '/users', id: String(user.id), expected: user }
  }
  if (!id) return {}
  const entity = path.match(/^\/(customers|devices|inventory|sales|purchase-orders|commercial-documents)(?:\/|$)/)?.[1]
  if (entity) return { resource: `/${entity}/${id}`, expected }
  if (/^\/cash\/(open|close)$/.test(path)) return { resource: `/cash/sessions/${id}`, expected }
  if (/^\/orders(?:\/[^/]+\/(plan|quote|status|signatures))?$/.test(path) || /^\/orders\/[^/]+$/.test(path)) return { resource: `/orders/${id}`, expected }
  const child = path.match(/^(\/orders\/[^/]+\/(notes|attachments|payments|quotes|parts))(?:\/|$)/)?.[1]
  if (child) return { resource: child, id, expected }
  const list = path.startsWith('/settings/branches') ? '/settings/branches' : path.startsWith('/suppliers') ? '/suppliers?includeInactive=true&take=100' : path.startsWith('/templates') ? '/templates?includeInactive=true' : path.startsWith('/transfers') ? '/transfers?take=100' : undefined
  return list ? { resource: list, id, expected } : {}
}

export function scrub(value: unknown): unknown {
  if (typeof value === 'string') return value
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(/([?&](?:token|code|access_token|sig)=)[^&\s"<>]+/gi, '$1[REDACTED]')
    .replace(/(\/t\/)[A-Za-z0-9_-]+/g, '$1[REDACTED]')
    .replace(/(\/public\/orders\/)[A-Za-z0-9_-]+/g, '$1[REDACTED]')
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /password|token|cookie|authorization|secret|signature|imageData|unlockValue/i.test(key) ? '[REDACTED]' : scrub(item)]))
  return value
}

export const test = base.extend<{ safeEvidence: void }>({
  safeEvidence: [async ({ context, page }, use, testInfo) => {
    const http: unknown[] = []
    const errors: string[] = []
    const pending: Promise<void>[] = []
    const writes: Mutation[] = []
    const incompleteWrites: string[] = []
    observedWrites.set(context, writes)
    let currentToken: string | undefined
    await context.addInitScript(() => {
      // Redact credential-bearing text in recordings; controls and DOM values remain real.
      const install = () => {
        if (!document.documentElement || document.getElementById('qa-evidence-privacy')) return
        const style = document.createElement('style')
        style.id = 'qa-evidence-privacy'
        style.textContent = ':root input[aria-label="Enlace"], :root a[href*="/t/"].break-all { -webkit-text-fill-color:transparent!important; color:transparent!important; background:#475569!important; caret-color:transparent!important; text-shadow:none!important; }'
        document.documentElement.append(style)
      }
      install()
      new MutationObserver(install).observe(document, { childList: true, subtree: true })
    })
    context.on('response', response => {
      if (!response.url().includes('/api/v1/')) return
      pending.push((async () => {
        const request = response.request()
        let body: unknown
        try {
          if (response.headers()['content-type']?.includes('json') && response.status() !== 204) {
            let timer: ReturnType<typeof setTimeout> | undefined
            try {
              body = await Promise.race([response.json(), new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('HTTP body read exceeded 10 seconds')), 10_000)
              })])
            } finally { clearTimeout(timer) }
          }
        } catch (error) {
          errors.push(`HTTP body unavailable: ${request.method()} ${new URL(response.url()).pathname}: ${String(error)}`)
          if (response.ok() && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && !response.url().includes('/auth/')) incompleteWrites.push(`${request.method()} ${new URL(response.url()).pathname}`)
        }
        let input: unknown
        try { input = request.postDataJSON() } catch { input = request.postData() ? '[BINARY_OR_FORM]' : undefined }
        const path = new URL(response.url()).pathname.replace('/api/v1', '')
        if (/^\/auth\/(login|refresh|switch-shop)$/.test(path) && response.ok()) currentToken = (body as { data?: { accessToken?: string } })?.data?.accessToken
        if (response.ok() && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && !path.startsWith('/auth/')) {
          const data = (body as { data?: unknown })?.data
          const bodies = Array.isArray(data) ? data.map(item => ({ data: item })) : [body]
          for (const entity of bodies) writes.push({ method: request.method(), path, authorization: request.headers().authorization, ...resourceFor(path, entity) })
        }
        http.push(scrub({ method: request.method(), url: response.url(), status: response.status(), input, body }))
      })())
    })
    context.on('page', p => p.on('pageerror', error => errors.push(String(scrub(error.message)))))
    page.on('pageerror', error => errors.push(String(scrub(error.message))))
    page.on('console', message => { if (message.type() === 'error') errors.push(String(scrub(message.text()))) })
    await use()
    await Promise.allSettled(pending)
    try {
    expect(incompleteWrites, 'Successful writes must have inspectable real response bodies').toEqual([])
    if (writes.length && testInfo.status === 'passed' && !page.isClosed()) {
      const hadSession = await page.evaluate(() => localStorage.getItem('rs.session') === '1')
      if (hadSession) {
        currentToken = (await reloadAuthenticated(page)).accessToken
      } else await page.reload()
      const last = new Map<string, Mutation>()
      for (const write of writes) if (write.resource) last.set(`${write.resource}:${write.id ?? ''}`, write)
      for (const write of last.values()) {
        const response = await context.request.get(`/api/v1${write.resource}`, { headers: { Authorization: currentToken ? `Bearer ${currentToken}` : write.authorization ?? '' } })
        expect(response.ok(), `Persistence GET ${write.resource}: HTTP ${response.status()}`).toBeTruthy()
        let actual = (await response.json()).data
        if (write.id) actual = actual.find((item: { id: string }) => item.id === write.id)
        expect(actual, `Persisted record ${write.resource}`).toBeTruthy()
        for (const key of ['id', 'shopId', 'customerId', 'deviceId', 'fullName', 'phone', 'brand', 'model', 'sku', 'name', 'status', 'issueDescription', 'assignedTechnicianId', 'priority', 'amount', 'currency', 'number', 'totalAmount', 'total', 'discountAmount', 'isActive', 'displayName', 'powersOn', 'screenOk', 'touchOk', 'camerasOk', 'audioOk', 'microphoneOk', 'buttonsOk', 'chargingOk', 'connectivityOk', 'biometricsOk', 'batteryHealthPercent', 'cloudLock', 'cosmeticNotes', 'passed', 'quantityUsed', 'inventoryItemId', 'body', 'isPublic', 'fileName', 'kind']) {
          if (write.expected && key in write.expected) expect(actual[key], `${write.resource}.${key}`).toEqual(write.expected[key])
        }
        write.result = 'Final entity revision verified by real GET after a browser reload'
      }
    }
    } finally {
    await Promise.allSettled(pending)
    await fs.writeFile(testInfo.outputPath('persistence-audit.json'), JSON.stringify(writes.map(({ authorization: _credential, ...write }) => scrub(write)), null, 2))
    await fs.writeFile(testInfo.outputPath('http-sanitized.json'), JSON.stringify(http, null, 2))
    await fs.writeFile(testInfo.outputPath('console-sanitized.json'), JSON.stringify(errors, null, 2))
    if (!page.isClosed()) await page.screenshot({ path: testInfo.outputPath('final.png'), fullPage: true })
    observedWrites.delete(context)
    }
  }, { auto: true }],
})

export { expect }
