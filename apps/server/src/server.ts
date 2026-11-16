import { randomUUID } from 'node:crypto'
import type { AdminAuth } from '@aicommerce/auth'
import { guestActor, type App, type AuditEntry, type AuditSink } from '@aicommerce/core'
import type { Database, RateLimiter } from '@aicommerce/db'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import { createOpenApi } from './openapi.js'

/** Better Auth reads the client address from this header; the server sets it, never the client. */
export const CLIENT_IP_HEADER = 'x-aicommerce-client-ip'
const MAX_BODY = 1024 * 1024
const MAX_AUTH_BODY = 64 * 1024
const LIMITS = {
  guest: { limit: 120, windowSeconds: 60 },
  admin: { limit: 600, windowSeconds: 60 },
  // Setup actions carry the one-time token: guessing it is limited per address, signed in or not.
  setup: { limit: 10, windowSeconds: 60 },
}
const STATUS: Record<string, ContentfulStatusCode> = {
  invalid_input: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  confirmation_required: 428,
  handler_error: 500,
}
const envelope = z.strictObject({ input: z.unknown(), confirmed: z.boolean().optional() })

export interface LogLine {
  at: string
  requestId: string
  method: string
  path: string
  action: string | null
  status: number
  ms: number
  actorType: string | null
}

export interface ServerOptions {
  /** The app, or a getter for one that may be replaced when modules switch. */
  app: App | (() => App)
  auth: AdminAuth
  /** Only used by /readyz. */
  database: Pick<Database, 'client'>
  rateLimiter: RateLimiter
  /** Where the shop is served; its origin is the one admin requests must come from. */
  publicUrl: string
  /** Adds HSTS. */
  production: boolean
  /** Records every POST to /api/auth (sign-in, 2FA changes, sign-out) by path and outcome. */
  audit: AuditSink
  /** More origins allowed to send admin requests. */
  trustedOrigins?: string[]
  /** Reverse proxies in front of the server whose X-Forwarded-For entries are trusted. Default 0. */
  trustedProxies?: number
  /** One line per request. Default: JSON on stdout. */
  log?: (line: LogLine) => void
}

type Env = { Variables: { requestId: string; action?: string; actorType?: string } }

/** The rate-limit key of an address: IPv6 by its /64, the block one subscriber usually holds. */
export function rateLimitAddress(ip: string): string {
  const address = ip.split('%')[0] ?? ip
  if (!address.includes(':')) return address
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped?.[1]) return mapped[1]
  const [head = '', tail = ''] = address.split('::')
  const left = head ? head.split(':') : []
  const right = address.includes('::') && tail ? tail.split(':') : []
  const groups = address.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':')}::/64`
}

function outcomeOf(status: number): AuditEntry['outcome'] {
  if (status < 400) return 'ok'
  if (status === 400 || status === 422) return 'invalid_input'
  if (status === 401 || status === 403 || status === 429) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  return 'handler_error'
}

const failure = (c: Context, status: ContentfulStatusCode, code: string, message: string) =>
  c.json({ ok: false, error: { code, message } }, status)

export function createServer(options: ServerOptions): Hono<Env> {
  const { auth, rateLimiter } = options
  const appOf = typeof options.app === 'function' ? options.app : () => options.app as App
  const trustedProxies = options.trustedProxies ?? 0
  const allowedOrigins = new Set([
    new URL(options.publicUrl).origin,
    ...(options.trustedOrigins ?? []),
  ])
  const log =
    options.log ??
    ((line: LogLine) => {
      console.info(JSON.stringify(line))
    })
  const openApis = new WeakMap<App, Record<string, unknown>>()

  // The socket address, or the entry the nearest trusted proxy appended to X-Forwarded-For.
  const clientIp = (c: Context): string => {
    let socket = 'unknown'
    try {
      socket = getConnInfo(c).remote.address ?? 'unknown'
    } catch {
      // Not served from a Node socket (tests).
    }
    if (trustedProxies === 0) return socket
    const hops = (c.req.header('x-forwarded-for') ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
    return hops[hops.length - trustedProxies] ?? socket
  }

  const server = new Hono<Env>()

  server.use('*', async (c, next) => {
    const started = performance.now()
    const requestId = randomUUID()
    c.set('requestId', requestId)
    await next()
    // A response from a handler (Better Auth) may have immutable headers.
    c.res = new Response(c.res.body, c.res)
    const headers = c.res.headers
    headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'no-referrer')
    headers.set('Cross-Origin-Resource-Policy', 'same-origin')
    headers.set('X-Request-Id', requestId)
    if (c.req.path.startsWith('/api')) headers.set('Cache-Control', 'no-store')
    if (options.production) {
      headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    log({
      at: new Date().toISOString(),
      requestId,
      method: c.req.method,
      path: c.req.path,
      action: c.get('action') ?? null,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
      actorType: c.get('actorType') ?? null,
    })
  })

  server.onError((error, c) => {
    console.error(`Request ${c.get('requestId')} failed`, error)
    return failure(c, 500, 'handler_error', 'Request failed')
  })
  server.notFound((c) => failure(c, 404, 'not_found', 'Not found'))

  server.get('/healthz', (c) => c.json({ ok: true }))
  server.get('/readyz', async (c) => {
    try {
      await options.database.client`select 1`
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false }, 503)
    }
  })

  server.on(
    ['GET', 'POST'],
    '/api/auth/*',
    bodyLimit({
      maxSize: MAX_AUTH_BODY,
      onError: (c) => failure(c, 413, 'payload_too_large', 'The body is over 64 KiB'),
    }),
    async (c) => {
      const ip = clientIp(c)
      const headers = new Headers(c.req.raw.headers)
      headers.set(CLIENT_IP_HEADER, ip)
      if (c.req.method !== 'POST') return auth.handler(new Request(c.req.raw, { headers }))
      // Read here, so the body limit applies before Better Auth parses anything.
      const body = await c.req.arrayBuffer()
      const started = performance.now()
      const session = await auth.session(c.req.raw.headers)
      const response = await auth.handler(new Request(c.req.url, { method: 'POST', headers, body }))
      try {
        await options.audit.write({
          actorType: session?.actor.type ?? 'guest',
          actorId: session?.actor.id ?? null,
          onBehalfOf: null,
          action: `auth.${c.req.path.slice('/api/auth/'.length).replaceAll('/', '.')}`,
          input: { ip },
          outcome: outcomeOf(response.status),
          durationMs: Math.round(performance.now() - started),
        })
      } catch (error) {
        console.error(`Audit of ${c.req.path} failed`, error)
      }
      return response
    },
  )

  server.get('/api/me', async (c) => {
    const session = await auth.session(c.req.raw.headers)
    const actor = session?.actor ?? guestActor
    c.set('actorType', actor.type)
    return c.json({
      actor: { type: actor.type, id: actor.id },
      permissions: [...actor.permissions].sort(),
      twoFactorRequired: session !== null && !session.twoFactorEnabled,
    })
  })

  server.get('/api/openapi.json', (c) => {
    const app = appOf()
    let doc = openApis.get(app)
    if (!doc) {
      doc = createOpenApi(app)
      openApis.set(app, doc)
    }
    return c.json(doc)
  })

  server.post(
    '/api/actions/:name',
    bodyLimit({
      maxSize: MAX_BODY,
      onError: (c) => failure(c, 413, 'payload_too_large', 'The body is over 1 MiB'),
    }),
    async (c) => {
      const name = c.req.param('name')
      c.set('action', name)
      if (!/^application\/json\s*(;|$)/i.test(c.req.header('content-type') ?? '')) {
        return failure(c, 415, 'unsupported_media_type', 'Send the body as application/json')
      }
      const session = await auth.session(c.req.raw.headers)
      const actor = session?.actor ?? guestActor
      c.set('actorType', actor.type)
      // A signed-in browser sends Origin; anything else carrying the cookie is a forged request.
      if (session && !allowedOrigins.has(c.req.header('origin') ?? '')) {
        return failure(c, 403, 'forbidden', 'Cross-site request rejected')
      }
      const limited = await rateLimiter.hit(
        session ? `api:admin:${actor.id ?? ''}` : `api:ip:${rateLimitAddress(clientIp(c))}`,
        session ? LIMITS.admin : LIMITS.guest,
      )
      const guarded =
        limited.allowed && name.startsWith('setup.') && name !== 'setup.status'
          ? await rateLimiter.hit(`setup:${rateLimitAddress(clientIp(c))}`, LIMITS.setup)
          : limited
      if (!guarded.allowed) {
        c.header('Retry-After', String(guarded.retryAfterSeconds))
        return failure(c, 429, 'rate_limited', 'Too many requests')
      }
      let body: unknown
      try {
        body = JSON.parse(await c.req.text())
      } catch {
        return failure(c, 400, 'invalid_input', 'The body is not valid JSON')
      }
      const parsed = envelope.safeParse(body)
      if (!parsed.success) {
        return c.json(
          {
            ok: false,
            error: {
              code: 'invalid_input',
              message: 'Send { input, confirmed? }',
              issues: parsed.error.issues,
            },
          },
          400,
        )
      }
      const result = await appOf().registry.call(name, parsed.data.input, {
        actor,
        confirmed: parsed.data.confirmed === true,
      })
      if (result.ok) return c.json(result, 200)
      const status =
        result.error.code === 'forbidden' && actor.type === 'guest'
          ? 401
          : (STATUS[result.error.code] ?? 500)
      return c.json(result, status)
    },
  )

  return server
}
