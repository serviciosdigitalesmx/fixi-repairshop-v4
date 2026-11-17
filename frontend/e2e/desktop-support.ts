import type { APIResponse, Page } from '@playwright/test'
import fs from 'node:fs/promises'
import { test, expect, scrub } from './web-fixtures'
import { login, type USERS } from './helpers'
import type { LoginResponse } from '../src/api/types'

export async function signIn(page: Page, role: keyof typeof USERS = 'admin') {
  const signedIn = page.waitForResponse(r => r.url().endsWith('/auth/login') && r.ok())
  await login(page, role)
  const session: LoginResponse = (await (await signedIn).json()).data
  let token = session.accessToken
  page.on('response', async response => {
    if (response.url().endsWith('/auth/refresh') && response.ok()) token = (await response.json()).data.accessToken
  })
  async function record(response: APIResponse, input?: unknown) {
    let body: unknown
    if (response.headers()['content-type']?.includes('json')) body = await response.json()
    await fs.appendFile(test.info().outputPath('api-readbacks.ndjson'), JSON.stringify(scrub({ url: response.url(), status: response.status(), input, body })) + '\n')
    return response
  }
  const api = {
    session,
    headers: () => ({ Authorization: `Bearer ${token}`, 'X-RS-Refresh': '1' }),
    get: async (path: string) => record(await page.context().request.get(`/api/v1${path}`, { headers: api.headers() })),
    post: async (path: string, data?: unknown) => record(await page.context().request.post(`/api/v1${path}`, { headers: api.headers(), data }), data),
    put: async (path: string, data: unknown) => record(await page.context().request.put(`/api/v1${path}`, { headers: api.headers(), data }), data),
    async read<T>(path: string): Promise<T> {
      const response = await api.get(path)
      expect(response.ok(), `Real GET ${path}: HTTP ${response.status()}`).toBeTruthy()
      return (await response.json()).data as T
    },
    async reload() {
      const restored = page.waitForResponse(r => r.url().endsWith('/auth/refresh') && r.ok())
      await page.reload()
      token = (await (await restored).json()).data.accessToken
    },
    async persisted<T>(path: string, expected: Partial<T>) {
      await api.reload()
      const actual = await api.read<T>(path)
      expect(actual as object).toMatchObject(expected)
      return actual
    },
  }
  return api
}

export async function write<T>(page: Page, method: string, path: string, action: () => Promise<unknown>): Promise<T> {
  const response = page.waitForResponse(r => r.request().method() === method && new URL(r.url()).pathname === `/api/v1${path}`)
  await action()
  const result = await response
  expect(result.ok(), `${method} ${path}: HTTP ${result.status()}`).toBeTruthy()
  return (await result.json()).data as T
}
