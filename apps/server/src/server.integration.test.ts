import { createRateLimiter, createDb } from '@aicommerce/db'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createServer } from './server.js'
import { BASE, createTestServer } from './testkit.js'

let t: Awaited<ReturnType<typeof createTestServer>>
let database: typeof t.database
let server: typeof t.server
let action: typeof t.action
let post: typeof t.post
let signedIn: typeof t.signedIn
let auditCount: typeof t.auditCount
let nextIp: typeof t.nextIp
let logs: string[]

beforeAll(async () => {
  t = await createTestServer()
  ;({ database, server, action, post, signedIn, auditCount, nextIp, logs } = t)
})
afterAll(async () => {
  await t.database.drop()
})

test('sample.greet returns 200 for a guest', async () => {
  const response = await action('sample.greet', { name: 'Ada' })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, output: { greeting: 'Hello, Ada' } })
})

test('guest gets 401, admin without permission 403', async () => {
  expect((await action('note.list', {})).status).toBe(401)
  const { cookie } = await signedIn([])
  expect((await action('note.list', {}, { cookie })).status).toBe(403)
})

test('an admin with 2FA and a role can act; without 2FA /api/me says 2FA is required', async () => {
  const withRole = await signedIn(['owner'], true)
  expect((await action('note.list', {}, { cookie: withRole.cookie })).status).toBe(200)
  const me = await server.request(`${BASE}/api/me`, { headers: { cookie: withRole.cookie } })
  expect(await me.json()).toEqual({
    actor: { type: 'admin', id: withRole.id },
    permissions: ['*'],
    twoFactorRequired: false,
  })
  const without = await signedIn(['owner'])
  const me2 = await server.request(`${BASE}/api/me`, { headers: { cookie: without.cookie } })
  expect(await me2.json()).toMatchObject({ permissions: [], twoFactorRequired: true })
  const guest = await server.request(`${BASE}/api/me`)
  expect(await guest.json()).toEqual({
    actor: { type: 'guest', id: null },
    permissions: [],
    twoFactorRequired: false,
  })
})

test('bad input is 400 with issues', async () => {
  const response = await action('sample.greet', {})
  expect(response.status).toBe(400)
  const body = (await response.json()) as { error: { code: string; issues: unknown[] } }
  expect(body.error.code).toBe('invalid_input')
  expect(body.error.issues.length).toBeGreaterThan(0)
  expect((await post('/api/actions/sample.greet', '{not json')).status).toBe(400)
  expect((await post('/api/actions/sample.greet', { input: {}, extra: 1 })).status).toBe(400)
})

test('an unknown action is 404', async () => {
  expect((await action('nope.nothing', {})).status).toBe(404)
})

test('cookie request from another origin is rejected', async () => {
  const { cookie } = await signedIn(['owner'], true)
  const before = await auditCount()
  for (const origin of ['https://evil.example', '']) {
    const response = await action('note.create', { values: { title: 'x' } }, { cookie, origin })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: { message: 'Cross-site request rejected' },
    })
  }
  expect(await auditCount()).toBe(before)
})

test('a non-JSON body is 415, an oversized body 413', async () => {
  expect(
    (await post('/api/actions/sample.greet', 'name=Ada', { contentType: 'text/plain' })).status,
  ).toBe(415)
  const big = JSON.stringify({ input: { name: 'x'.repeat(1024 * 1024) } })
  expect((await post('/api/actions/sample.greet', big)).status).toBe(413)
})

test('the 121st guest call in a minute is 429 with Retry-After', async () => {
  // Limits count in fixed 60 s windows; start well inside one so the count cannot reset midway.
  const second = new Date().getUTCSeconds()
  if (second >= 50) await new Promise((resolve) => setTimeout(resolve, (61 - second) * 1000))
  const ip = nextIp()
  for (let i = 0; i < 120; i++) {
    expect((await action('sample.greet', { name: 'Ada' }, { ip })).status).toBe(200)
  }
  const limited = await action('sample.greet', { name: 'Ada' }, { ip })
  expect(limited.status).toBe(429)
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
  expect((await action('sample.greet', { name: 'Ada' })).status).toBe(200)
}, 60_000)

test('a destructive action needs confirmed: true (428 without)', async () => {
  const { cookie } = await signedIn(['owner'], true)
  const created = (await (
    await action('note.create', { values: { title: 'Doomed' } }, { cookie })
  ).json()) as {
    output: { id: string }
  }
  const input = { id: created.output.id, version: 1 }
  expect((await action('note.delete', input, { cookie })).status).toBe(428)
  expect((await action('note.delete', input, { cookie, confirmed: true })).status).toBe(200)
})

test('every response carries the security headers', async () => {
  for (const response of [
    await server.request(`${BASE}/healthz`),
    await action('sample.greet', { name: 'Ada' }),
    await action('nope.nothing', {}),
  ]) {
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    )
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(response.headers.get('strict-transport-security')).toBeNull()
  }
  expect((await action('sample.greet', { name: 'Ada' })).headers.get('cache-control')).toBe(
    'no-store',
  )
})

test('/readyz is 503 when the database is down', async () => {
  expect((await server.request(`${BASE}/readyz`)).status).toBe(200)
  expect(await (await server.request(`${BASE}/healthz`)).json()).toEqual({ ok: true })
  const closed = createDb(process.env.DATABASE_URL ?? '')
  await closed.close()
  const down = createServer({
    app: t.app,
    auth: t.auth,
    audit: { write: () => Promise.resolve() },
    database: closed,
    rateLimiter: createRateLimiter(database),
    publicUrl: BASE,
    production: true,
    log: () => undefined,
  })
  expect((await down.request(`${BASE}/readyz`)).status).toBe(503)
  expect((await down.request(`${BASE}/healthz`)).headers.get('strict-transport-security')).toBe(
    'max-age=31536000; includeSubDomains',
  )
})

test('the log line never contains the request body', async () => {
  logs.length = 0
  await action('sample.greet', { name: 'Ada', password: 'hunter2-secret-value' })
  await action('sample.greet', { name: 'Ada' })
  expect(logs.join('\n')).not.toContain('hunter2')
  const line = JSON.parse(logs.at(-1) ?? '{}') as Record<string, unknown>
  expect(Object.keys(line).sort()).toEqual(
    ['action', 'actorType', 'at', 'method', 'ms', 'path', 'requestId', 'status'].sort(),
  )
  expect(line).toMatchObject({ action: 'sample.greet', status: 200, actorType: 'guest' })
})

test('a forged client address header cannot reach Better Auth', async () => {
  const response = await server.request(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      'x-forwarded-for': nextIp(),
      'x-aicommerce-client-ip': '1.2.3.4',
    },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'correct horse battery' }),
  })
  expect(response.status).toBe(401)
  const keys = await database.client`select key from rate_limit where key like 'auth:%1.2.3.4%'`
  expect(keys).toHaveLength(0)
})

test('an auth request over 64 KiB is 413 before Better Auth reads it', async () => {
  const response = await post('/api/auth/sign-in/email', {
    email: 'nobody@example.com',
    password: 'x'.repeat(70 * 1024),
  })
  expect(response.status).toBe(413)
})

test('guest addresses in one IPv6 /64 share a rate limit', async () => {
  const second = new Date().getUTCSeconds()
  if (second >= 50) await new Promise((resolve) => setTimeout(resolve, (61 - second) * 1000))
  for (let i = 1; i <= 120; i++) {
    const ip = `2001:db8:77:1::${i.toString(16)}`
    expect((await action('sample.greet', { name: 'Ada' }, { ip })).status).toBe(200)
  }
  const limited = await action('sample.greet', { name: 'Ada' }, { ip: '2001:db8:77:1:ffff::1' })
  expect(limited.status).toBe(429)
}, 60_000)

test('auth requests are audited by path and outcome, never with the body', async () => {
  const ip = nextIp()
  await post(
    '/api/auth/sign-in/email',
    { email: 'nobody@example.com', password: 'a-wrong-password-1234' },
    { ip },
  )
  const [failed] = await database.client`select * from audit_log
    where action = 'auth.sign-in.email' order by id desc limit 1`
  expect(failed).toMatchObject({ actor_type: 'guest', outcome: 'forbidden', input: { ip } })
  expect(JSON.stringify(failed)).not.toContain('a-wrong-password')

  const admin = await signedIn([])
  await post('/api/auth/sign-out', {}, { cookie: admin.cookie })
  const [out] = await database.client`select * from audit_log
    where action = 'auth.sign-out' order by id desc limit 1`
  expect(out).toMatchObject({ actor_type: 'admin', actor_id: admin.id, outcome: 'ok' })
})
