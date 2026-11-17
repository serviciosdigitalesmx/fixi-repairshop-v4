import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import type { ApiResponse, LoginResponse, Page, ProblemDetails } from './types'

// '/api/v1' works with the Vite dev proxy and with a reverse proxy in production.
// Set VITE_API_BASE (e.g. https://api.mitaller.com/api/v1) when the API lives on another origin.
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/v1'

const REFRESH_HEADER = { 'X-RS-Refresh': '1' }

/**
 * Session tokens. The access token lives only in memory (never in localStorage), so an XSS can't read a
 * long-lived credential. The refresh token is an httpOnly cookie handled by the browser.
 */
let accessToken: string | null = null
let sessionListener: ((session: LoginResponse | null) => void) | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
}

export function onSessionChange(listener: (session: LoginResponse | null) => void) {
  sessionListener = listener
}

// Non-sensitive hint that this browser had a session, so anonymous visitors (login page, public tracking
// portal) don't fire a refresh request that can only fail. The credential itself stays in the httpOnly cookie.
const SESSION_HINT = 'rs.session'

export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT) === '1'
  } catch {
    return true
  }
}

export function setSessionHint(active: boolean) {
  try {
    if (active) localStorage.setItem(SESSION_HINT, '1')
    else localStorage.removeItem(SESSION_HINT)
  } catch {
    // storage blocked: we'll just try the refresh next time
  }
}

function correlationId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const http = axios.create({ baseURL: API_BASE, withCredentials: true })

http.interceptors.request.use((config) => {
  config.headers = config.headers ?? {}
  if (accessToken && !config.headers.Authorization) config.headers.Authorization = `Bearer ${accessToken}`
  if (!config.headers['X-Correlation-Id']) config.headers['X-Correlation-Id'] = correlationId()
  return config
})

// One refresh at a time: concurrent 401s wait for the same promise.
let refreshing: Promise<LoginResponse | null> | null = null

export function refreshSession(): Promise<LoginResponse | null> {
  if (!refreshing) {
    refreshing = axios
      .post<ApiResponse<LoginResponse>>(`${API_BASE}/auth/refresh`, null, { withCredentials: true, headers: REFRESH_HEADER })
      .then((res) => {
        const session = res.data.data
        accessToken = session.accessToken
        setSessionHint(true)
        sessionListener?.(session)
        return session
      })
      .catch(() => {
        accessToken = null
        setSessionHint(false)
        sessionListener?.(null)
        return null
      })
      .finally(() => {
        setTimeout(() => (refreshing = null), 0)
      })
  }
  return refreshing
}

http.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined
    const url = original?.url ?? ''
    const isAuthCall = url.includes('/auth/login') || url.includes('/auth/refresh')

    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true
      const session = await refreshSession()
      if (session) {
        original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${session.accessToken}` }
        return http(original)
      }
    }
    return Promise.reject(error)
  }
)

export const authHeaders = REFRESH_HEADER

// ===== Helpers that unwrap ApiResponse<T> =====

export async function get<T>(url: string, params?: object): Promise<T> {
  const res = await http.get<ApiResponse<T>>(url, { params: clean(params) })
  return res.data.data
}

export async function getPage<T>(url: string, params?: object): Promise<Page<T>> {
  const res = await http.get<ApiResponse<T[]>>(url, { params: clean(params) })
  const total = Number(res.headers['x-total-count'] ?? res.data.data.length)
  return { items: res.data.data, total }
}

export async function post<T>(url: string, body?: unknown, options?: { idempotencyKey?: string; headers?: Record<string, string> }): Promise<T> {
  const headers: Record<string, string> = { ...(options?.headers ?? {}) }
  if (options?.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
  const res = await http.post<ApiResponse<T>>(url, body ?? {}, { headers })
  return res.data?.data
}

export async function put<T>(url: string, body?: unknown): Promise<T> {
  const res = await http.put<ApiResponse<T>>(url, body ?? {})
  return res.data?.data
}

export async function del(url: string): Promise<void> {
  await http.delete(url)
}

export async function upload<T>(url: string, file: File, fields?: Record<string, string>, params?: object): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  for (const [k, v] of Object.entries(fields ?? {})) form.append(k, v)
  const res = await http.post<ApiResponse<T>>(url, form, { params: clean(params) })
  return res.data.data
}

/** Downloads a binary (PDF/XLSX) with the bearer token and returns a blob URL. */
export async function fetchBlob(url: string, params?: object): Promise<{ blobUrl: string; fileName?: string; res: AxiosResponse<Blob> }> {
  const res = await http.get<Blob>(url, { responseType: 'blob', params: clean(params) })
  const disposition = String(res.headers['content-disposition'] ?? '')
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)
  return { blobUrl: URL.createObjectURL(res.data), fileName: match ? decodeURIComponent(match[1]) : undefined, res }
}

export function newIdempotencyKey() {
  return correlationId()
}

function clean(params?: object) {
  if (!params) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    out[k] = v
  }
  return out
}

// ===== Errors =====

// Infrastructure diagnostics belong in developer tools, never in customer-facing messages.
function userText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const technical = /Request failed|AxiosError|status code|\bHTTP\s*\d{3}|\b(?:Npgsql|SqlException|TypeError|ReferenceError|SyntaxError|stack trace|ECONN|ETIMEDOUT)|System\.|Exception:|violates .*constraint|^The .*(?:field|required|valid)|^(?:Forbidden|Unauthorized|Bad Request|Not Found|Conflict|Internal Server Error)$/i
  return technical.test(value) ? undefined : value
}

export function toProblem(err: unknown): ProblemDetails {
  const e = err as AxiosError<ProblemDetails>
  const status = e?.response?.status
  const data = e?.response?.data
  const problem: ProblemDetails = data && typeof data === 'object' && ('title' in data || 'detail' in data || 'errors' in data) ? { ...data, status } : { status }
  const friendly = (title: string, detail: string): ProblemDetails => ({ ...problem, title, detail, errors: undefined })
  if (status === 401) {
    const login = e?.config?.url?.split('?')[0].endsWith('/auth/login')
    return friendly(login ? 'No pudimos iniciar sesión' : 'Inicia sesión nuevamente', userText(problem.detail) ?? (login ? 'Revisa tu correo y contraseña e inténtalo de nuevo.' : 'Tu sesión terminó. Vuelve a iniciar sesión para continuar.'))
  }
  if (status === 403) return friendly('Acceso no permitido', 'Tu cuenta no tiene permiso para realizar esta acción. Consulta al administrador.')
  if (status === 404) return friendly('Información no disponible', 'No encontramos la información solicitada. Actualiza la página o revisa el enlace.')
  if (status === 429) return friendly('Demasiadas solicitudes', 'Espera un momento e inténtalo de nuevo.')
  if (status === 408 || status === 504 || e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') return friendly('La solicitud tardó demasiado', 'Revisa si la operación se completó antes de volver a intentarlo.')
  if (status && status >= 500) return friendly('No pudimos completar la solicitud', 'Ocurrió un problema en el servicio. Revisa si la operación se completó antes de volver a intentarlo.')
  if (e?.code === 'ERR_NETWORK') return friendly('Sin conexión', 'No se pudo conectar con el servidor. Revisa tu conexión.')
  const errors = problem.errors && typeof problem.errors === 'object' && !Array.isArray(problem.errors)
    ? Object.fromEntries(Object.entries(problem.errors).map(([key, messages]) => [key, (Array.isArray(messages) ? messages : [messages]).map(message => userText(message) ?? 'Revisa este dato e inténtalo de nuevo.')]))
    : undefined
  return {
    ...problem,
    title: userText(problem.title) ?? 'No pudimos completar la operación',
    detail: userText(problem.detail) ?? userText(problem.title) ?? (status === 400 || status === 422 ? 'Revisa los datos e inténtalo de nuevo.' : 'Ocurrió un problema. Inténtalo de nuevo; si continúa, contacta a soporte.'),
    errors,
  }
}

/** One human-readable sentence for toasts. */
export function errorMessage(err: unknown): string {
  const p = toProblem(err)
  if (p.errors) {
    const first = Object.values(p.errors).flat()[0]
    if (first) return first
  }
  return p.detail || p.title || 'Ocurrió un error.'
}

/** Field errors keyed by camelCase field name (as returned by the API). */
export function fieldErrors(err: unknown): Record<string, string> {
  const p = toProblem(err)
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(p.errors ?? {})) if (v?.length) out[k] = v[0]
  return out
}
