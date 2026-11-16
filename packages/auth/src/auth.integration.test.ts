import { coreMigrations, runMigrations } from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import * as OTPAuth from 'otpauth'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { authMigrations, createAdminAuth, type AdminAuth } from './index.js'

const BASE = 'http://localhost:3000'
const PASSWORD = 'correct horse battery'
let database: TestDb
let auth: AdminAuth
let nextIp = 1

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations, authMigrations], { log: () => undefined })
  auth = createAdminAuth({
    database,
    baseURL: BASE,
    secret: 'a-test-secret-that-is-long-enough-1234567890',
    trustedOrigins: [BASE],
    production: false,
  })
})
afterAll(async () => {
  await database.drop()
})

// Each test signs in from its own address, so rate limits never leak between tests.
const client = () => {
  const ip = `10.0.0.${String(nextIp++)}`
  let cookie = ''
  const send = async (path: string, body?: unknown) => {
    const response = await auth.handler(
      new Request(`${BASE}/api/auth${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          origin: BASE,
          'x-forwarded-for': ip,
          ...(cookie && { cookie }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    )
    const set = response.headers.getSetCookie().map((c) => c.split(';')[0] ?? '')
    if (set.length > 0) {
      const jar = new Map(
        cookie ? cookie.split('; ').map((c) => c.split('=') as [string, string]) : [],
      )
      for (const c of set) {
        const [name = '', value = ''] = c.split('=')
        if (value === '') jar.delete(name)
        else jar.set(name, value)
      }
      cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ')
    }
    return response
  }
  return {
    send,
    signIn: (email: string, password = PASSWORD) => send('/sign-in/email', { email, password }),
    actor: () => auth.resolveActor(new Headers(cookie ? { cookie } : {})),
    hasSession: () => cookie.includes('aicommerce-admin.session_token='),
  }
}

let n = 0
const admin = async (roles: string[] = []) => {
  const email = `admin${String(n++)}@example.com`
  const { id } = await auth.identity.createAdmin({ email, name: 'Admin', password: PASSWORD })
  for (const role of roles) {
    await database.client`insert into admin_user_role (user_id, role_id) values (${id}, ${role})`
  }
  return { id, email }
}

const enableTotp = async (c: ReturnType<typeof client>) => {
  const enabled = await c.send('/two-factor/enable', { password: PASSWORD })
  expect(enabled.status).toBe(200)
  const { totpURI } = (await enabled.json()) as { totpURI: string }
  // The label is percent-encoded; the issuer parameter is form-encoded ("+" for a space).
  expect(totpURI.startsWith('otpauth://totp/AI%20Commerce:')).toBe(true)
  expect(new URL(totpURI).searchParams.get('issuer')).toBe('AI Commerce')
  const totp = OTPAuth.URI.parse(totpURI) as OTPAuth.TOTP
  expect((await c.send('/two-factor/verify-totp', { code: totp.generate() })).status).toBe(200)
  return totp
}

test('sign-in with the right password creates a session', async () => {
  const { id, email } = await admin()
  const c = client()
  expect((await c.signIn(email)).status).toBe(200)
  expect(c.hasSession()).toBe(true)
  expect(await c.actor()).toMatchObject({ type: 'admin', id })
})

test('a wrong password creates no session', async () => {
  const { email } = await admin()
  const c = client()
  expect((await c.signIn(email, 'wrong password!!')).status).toBe(401)
  expect(c.hasSession()).toBe(false)
  expect(await c.actor()).toBeNull()
})

test('the sixth failed sign-in within a minute is refused with 429', async () => {
  const { email } = await admin()
  // Limits count in fixed 60 s windows; start well inside one so the count cannot reset midway.
  const second = new Date().getUTCSeconds()
  if (second >= 55) await new Promise((resolve) => setTimeout(resolve, (61 - second) * 1000))
  const c = client()
  const statuses = []
  for (let i = 0; i < 6; i++) statuses.push((await c.signIn(email, 'wrong password!!')).status)
  expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
  expect((await c.signIn(email)).status).toBe(429)
  // Up to 6 s of waiting for a fresh window above.
}, 15_000)

test('an admin without 2FA has no permissions', async () => {
  const { email } = await admin(['owner'])
  const c = client()
  await c.signIn(email)
  const actor = await c.actor()
  expect(actor?.type).toBe('admin')
  expect([...(actor?.permissions ?? [])]).toEqual([])
})

test('after enabling 2FA, sign-in needs the TOTP code and the actor has its role permissions', async () => {
  const { email } = await admin(['owner'])
  const setup = client()
  await setup.signIn(email)
  const totp = await enableTotp(setup)

  const c = client()
  const first = await c.signIn(email)
  expect(await first.json()).toMatchObject({ twoFactorRedirect: true })
  expect(c.hasSession()).toBe(false)
  expect(await c.actor()).toBeNull()
  expect((await c.send('/two-factor/verify-totp', { code: '000000' })).status).toBe(401)
  expect((await c.send('/two-factor/verify-totp', { code: totp.generate() })).status).toBe(200)
  expect(c.hasSession()).toBe(true)
  expect([...((await c.actor())?.permissions ?? [])]).toEqual(['*'])
})

test('a disabled admin cannot sign in and their session stops working', async () => {
  const { id, email } = await admin(['owner'])
  const c = client()
  await c.signIn(email)
  expect(await c.actor()).not.toBeNull()
  await auth.identity.setDisabled(id, true)
  expect(await c.actor()).toBeNull()
  const again = client()
  expect((await again.signIn(email)).status).not.toBe(200)
  expect(again.hasSession()).toBe(false)
})

test('an expired session resolves to guest', async () => {
  const { id, email } = await admin()
  const c = client()
  await c.signIn(email)
  await database.client`update admin_session set expires_at = now() - interval '1 minute'
    where user_id = ${id}`
  expect(await c.actor()).toBeNull()
})

test('self sign-up is disabled', async () => {
  const c = client()
  const response = await c.send('/sign-up/email', {
    email: 'intruder@example.com',
    password: PASSWORD,
    name: 'Intruder',
  })
  expect(response.status).toBeGreaterThanOrEqual(400)
  expect(
    await database.client`select id from admin_user where email = 'intruder@example.com'`,
  ).toHaveLength(0)
})

test('createAdmin refuses a short password and a duplicate email', async () => {
  await expect(
    auth.identity.createAdmin({ email: 'short@example.com', name: 'S', password: 'too short' }),
  ).rejects.toThrow('Password must be 12 to 128 characters')
  const { email } = await admin()
  await expect(
    auth.identity.createAdmin({ email: email.toUpperCase(), name: 'D', password: PASSWORD }),
  ).rejects.toThrow('already exists')
})
