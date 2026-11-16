import type { T } from './i18n'

export interface Failure {
  code: string
  message: string
  issues?: { path: (string | number)[]; message: string }[]
}
export type Result<T> = { ok: true; output: T } | { ok: false; error: Failure }

// Same origin: the admin proxies /api to the server, so the session cookie and Origin just work.
async function post<T>(path: string, body: unknown): Promise<Result<T>> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, error: { code: 'network', message: 'No answer' } }
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null
  // A proxy error page or an empty body: the server is not really there.
  if (data === null) return { ok: false, error: { code: 'network', message: 'No JSON answer' } }
  if (response.status === 429) {
    return { ok: false, error: { code: 'rate_limited', message: 'Too many requests' } }
  }
  if (typeof data.ok === 'boolean') return data as Result<T>
  // Better Auth answers with the plain body, or { code, message } on failure.
  if (response.ok) return { ok: true, output: data as T }
  return {
    ok: false,
    error: {
      code: typeof data.code === 'string' ? data.code : String(response.status),
      message: typeof data.message === 'string' ? data.message : '',
    },
  }
}

export const action = <T>(name: string, input: unknown) =>
  post<T>(`/api/actions/${name}`, { input })

export const authCall = <T>(path: string, body: unknown) => post<T>(`/api/auth/${path}`, body)

/** The input fields the server named in an invalid_input error. */
export const invalidFields = (error: Failure): Set<string> =>
  new Set(error.code === 'invalid_input' ? (error.issues ?? []).map((i) => String(i.path[0])) : [])

/** A translated sentence for failures that are not about one field. */
export function errorText(t: T, error: Failure): string {
  if (error.code === 'network') return t('errors.network')
  if (error.code === 'rate_limited') return t('errors.rateLimited')
  if (error.code === 'forbidden') return t('errors.token')
  return t('errors.unknown')
}
