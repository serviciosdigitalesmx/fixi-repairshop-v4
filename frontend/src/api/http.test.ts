import { describe, expect, it } from 'vitest'
import { errorMessage, fieldErrors, toProblem } from './http'

const axiosError = (status: number, data?: unknown, code?: string) => ({ isAxiosError: true, code, message: 'Request failed', response: status ? { status, data } : undefined })

describe('API errors', () => {
  it('uses the ProblemDetails text', () => {
    const err = axiosError(409, { title: 'Conflicto', detail: 'El stock cambió.' })
    expect(errorMessage(err)).toBe('El stock cambió.')
    expect(toProblem(err).status).toBe(409)
  })

  it('prefers the first validation error', () => {
    const err = axiosError(400, { title: 'Datos inválidos', errors: { phone: ['El teléfono es obligatorio.'], email: ['Correo electrónico inválido.'] } })
    expect(errorMessage(err)).toBe('El teléfono es obligatorio.')
    expect(fieldErrors(err)).toEqual({ phone: 'El teléfono es obligatorio.', email: 'Correo electrónico inválido.' })
  })

  it('explains rate limiting and network failures', () => {
    expect(toProblem(axiosError(429)).title).toBe('Demasiadas solicitudes')
    expect(errorMessage(axiosError(0, undefined, 'ERR_NETWORK'))).toMatch(/No se pudo conectar/)
  })
})

describe('customer-facing API errors', () => {
  it.each([401, 403, 404, 408, 429, 500, 502, 503, 504])('translates an empty HTTP %i response instead of exposing Axios', status => {
    const err = { ...axiosError(status), message: `Request failed with status code ${status}` }
    expect(errorMessage(err)).not.toMatch(/Request failed|Axios|HTTP|status code|\b[45]\d{2}\b/)
    expect(errorMessage(err).length).toBeGreaterThan(20)
    expect(toProblem(err).status).toBe(status)
  })
  it('gives permission guidance even if forbidden details or validation errors are technical', () => {
    const err = axiosError(403, { title: 'Forbidden', detail: 'Authorization failed: HTTP 403', errors: { role: ['Request failed with status code 403'] } })
    expect(errorMessage(err)).toBe('Tu cuenta no tiene permiso para realizar esta acción. Consulta al administrador.')
    expect(fieldErrors(err)).toEqual({})
  })
  it('does not reveal server internals, tracebacks or database details', () => {
    const err = axiosError(500, { title: 'Database failure', detail: 'Npgsql.PostgresException: SQL SELECT secret FROM users', errors: { database: ['private connection information'] } })
    expect(errorMessage(err)).not.toMatch(/Npgsql|SQL|SELECT|secret|private/)
    expect(fieldErrors(err)).toEqual({})
  })
  it('preserves useful business conflicts and subscription metadata', () => {
    expect(errorMessage(axiosError(409, { title: 'Conflicto', detail: 'El stock cambió.' }))).toBe('El stock cambió.')
    expect(toProblem(axiosError(402, { title: 'Suscripción vencida', detail: 'Elige un plan para continuar.', code: 'subscription_inactive' }))).toMatchObject({ code: 'subscription_inactive', detail: 'Elige un plan para continuar.' })
  })
  it.each(['ECONNABORTED', 'ETIMEDOUT'])('explains %s without encouraging a duplicate operation', code => {
    expect(errorMessage(axiosError(0, undefined, code))).toBe('Revisa si la operación se completó antes de volver a intentarlo.')
  })
  it('handles unknown errors and malformed validation responses safely', () => {
    expect(errorMessage(new Error('TypeError: private implementation detail'))).not.toContain('TypeError')
    expect(errorMessage(axiosError(400, { errors: { phone: 'System.ArgumentException: bad value' } }))).toBe('Revisa este dato e inténtalo de nuevo.')
    expect(() => errorMessage(axiosError(400, { errors: 'invalid shape' }))).not.toThrow()
    expect(errorMessage(axiosError(400, { detail: 'Request failed with status code 400' }))).toBe('Revisa los datos e inténtalo de nuevo.')
  })
})

it('distinguishes incorrect login credentials from an expired session', () => {
  const login = { ...axiosError(401), config: { url: '/auth/login' } }
  expect(errorMessage(login)).toBe('Revisa tu correo y contraseña e inténtalo de nuevo.')
  expect(errorMessage(axiosError(401))).toBe('Tu sesión terminó. Vuelve a iniciar sesión para continuar.')
})
it('preserves actionable authentication errors supplied by the application', () => {
  expect(errorMessage(axiosError(401, { detail: 'Email o contraseña incorrectos.' }))).toBe('Email o contraseña incorrectos.')
  expect(errorMessage(axiosError(401, { detail: 'Tu usuario no tiene sucursales activas.' }))).toBe('Tu usuario no tiene sucursales activas.')
})
