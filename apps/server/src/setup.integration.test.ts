import { issueSetupToken } from '@aicommerce/module-setup'
import { guestActor, systemActor } from '@aicommerce/core'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createTestServer, PASSWORD } from './testkit.js'

type T = Awaited<ReturnType<typeof createTestServer>>
const servers: T[] = []
const fresh = async () => {
  const t = await createTestServer()
  servers.push(t)
  const token = await issueSetupToken(t.database)
  if (!token) throw new Error('no token on a fresh install')
  return { t, token }
}
afterAll(async () => {
  for (const t of servers) {
    await t.stop()
    await t.database.drop()
  }
})

const call = (t: T, name: string, input: unknown) =>
  t.app.registry.call(name, input, { actor: guestActor })
const owner = { email: 'owner@example.com', name: 'Owner', password: PASSWORD }
const shop = { name: 'Ada Shop', country: 'NL', currency: 'EUR', language: 'en' }
const turnOnTwoFactor = (t: T) =>
  t.database.client`update admin_user set two_factor_enabled = true where email = ${owner.email}`
const next = async (t: T) =>
  ((await call(t, 'setup.status', {})) as { output: { next: string } }).output.next

let shared: { t: T; token: string }
beforeAll(async () => {
  shared = await fresh()
})

test('setup actions need the token', async () => {
  const { t } = shared
  for (const token of [undefined, 'wrong', shared.token.slice(0, -1)]) {
    expect(await call(t, 'setup.create-owner', { ...owner, token })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
  }
  const [row] = await t.database.client`select token_hash from setup_state`
  expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/)
  expect(row?.token_hash).not.toContain(shared.token)
})

test('guessing the token is rate-limited', async () => {
  const { t } = shared
  const statuses: number[] = []
  for (let i = 0; i < 11; i++) {
    const response = await t.action(
      'setup.save-shop',
      { ...shop, token: 'guess' },
      { ip: '10.9.9.9' },
    )
    statuses.push(response.status)
  }
  expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
  expect(statuses[10]).toBe(429)
  // setup.status is not counted: the setup page polls it.
  expect((await t.action('setup.status', {}, { ip: '10.9.9.9' })).status).toBe(200)
})

test('status reports the next step', async () => {
  const { t, token } = shared
  const status = (await call(t, 'setup.status', {})) as {
    output: { finished: boolean; database: { ok: boolean; version: string | null } }
  }
  expect(status.output).toMatchObject({ finished: false, database: { ok: true } })
  expect(status.output.database.version).toMatch(/^17/)
  expect(await next(t)).toBe('owner')
  expect(await call(t, 'setup.create-owner', { ...owner, token })).toMatchObject({ ok: true })
  expect(await next(t)).toBe('two-factor')
  await turnOnTwoFactor(t)
  expect(await next(t)).toBe('shop')
  expect(await call(t, 'setup.save-shop', { ...shop, token })).toMatchObject({ ok: true })
  expect(await next(t)).toBe('modules')
  expect(await call(t, 'setup.choose-modules', { token, preset: 'minimal' })).toMatchObject({
    ok: true,
  })
  // Reloading after the choice resumes at the last step and keeps the choice.
  expect(await next(t)).toBe('finish')
  expect(await call(t, 'setup.finish', { token })).toMatchObject({ ok: true })
  expect(await next(t)).toBe('done')
})

test('create-owner twice is a conflict', async () => {
  const { t, token } = await fresh()
  expect(await call(t, 'setup.create-owner', { ...owner, token })).toMatchObject({ ok: true })
  expect(
    await call(t, 'setup.create-owner', { ...owner, email: 'other@example.com', token }),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } })
})

test('finish needs the owner to have 2FA', async () => {
  const { t, token } = await fresh()
  await call(t, 'setup.create-owner', { ...owner, token })
  await call(t, 'setup.save-shop', { ...shop, token })
  await call(t, 'setup.choose-modules', { token, preset: 'minimal' })
  expect(await call(t, 'setup.finish', { token })).toMatchObject({
    ok: false,
    error: { code: 'conflict', message: 'The owner must turn on two-factor authentication first' },
  })
  await turnOnTwoFactor(t)
  expect(await call(t, 'setup.finish', { token })).toMatchObject({ ok: true })
})

test.each([
  ['minimal', ['system', 'access', 'setup']],
  ['full', ['system', 'access', 'sample', 'setup', 'media', 'catalog', 'search']],
])('finish enables the chosen preset and locks setup: %s', async (preset, expected) => {
  const { t, token } = await fresh()
  await call(t, 'setup.create-owner', { ...owner, token })
  await turnOnTwoFactor(t)
  await call(t, 'setup.save-shop', { ...shop, token })
  expect(await call(t, 'setup.choose-modules', { token, preset })).toMatchObject({
    ok: true,
    output: { enabled: expected },
  })
  expect(await call(t, 'setup.finish', { token })).toMatchObject({ ok: true })
  const [state] = await t.database.client`select token_hash, finished_at from setup_state`
  expect(state?.token_hash).toBeNull()
  expect(state?.finished_at).not.toBeNull()
  expect(
    await t.until(() => Promise.resolve(t.host.current().modules.join() === expected.join())),
  ).toBe(true)
})

test('a finished setup refuses everything', async () => {
  const { t, token } = shared
  for (const [name, input] of [
    ['setup.create-owner', { ...owner, token }],
    ['setup.save-shop', { ...shop, token }],
    ['setup.choose-modules', { token, preset: 'full' }],
    ['setup.finish', { token }],
  ] as const) {
    expect(await call(t, name, input)).toMatchObject({
      ok: false,
      error: { code: 'forbidden', message: 'Setup is finished' },
    })
  }
  // Not even an owner gets back in.
  expect(await t.app.registry.call('setup.finish', {}, { actor: systemActor })).toMatchObject({
    ok: false,
    error: { message: 'Setup is finished' },
  })
  expect(await issueSetupToken(t.database)).toBeNull()
})

test('the AI key is stored as a secret setting', async () => {
  const { t, token } = await fresh()
  await call(t, 'setup.save-shop', { ...shop, aiKey: 'sk-test-12345', token })
  const [row] = await t.database
    .client`select value, encrypted from setting where key = 'setup.ai-key'`
  expect(row?.value).toBeNull()
  expect(row?.encrypted).toMatch(/^v1\./)
  expect(JSON.stringify(row)).not.toContain('sk-test-12345')
  const [audit] = await t.database.client`select input from audit_log
    where action = 'setup.save-shop' order by id desc limit 1`
  expect(JSON.stringify(audit?.input)).not.toContain('sk-test-12345')
  expect(JSON.stringify(audit?.input)).not.toContain(token)
})

test('a restart before 2FA issues a new token that carries setup on', async () => {
  const { t, token: old } = await fresh()
  await call(t, 'setup.create-owner', { ...owner, token: old })
  // The tab closed before 2FA and the server restarted.
  const token = await issueSetupToken(t.database)
  expect(token).toEqual(expect.any(String))
  expect(token).not.toBe(old)
  if (!token) return
  expect(await call(t, 'setup.save-shop', { ...shop, token: old })).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  })
  expect(
    await call(t, 'setup.create-owner', { ...owner, email: 'other@example.com', token }),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } })
  expect(await next(t)).toBe('two-factor')
  expect(await call(t, 'setup.save-shop', { ...shop, token })).toMatchObject({ ok: true })
  await call(t, 'setup.choose-modules', { token, preset: 'minimal' })
  expect(await call(t, 'setup.finish', { token })).toMatchObject({
    ok: false,
    error: { code: 'conflict', message: 'The owner must turn on two-factor authentication first' },
  })
  await turnOnTwoFactor(t)
  expect(await call(t, 'setup.finish', { token })).toMatchObject({ ok: true })
  expect(await issueSetupToken(t.database)).toBeNull()
})

test('strangers using up the address limit do not lock out the signed-in owner', async () => {
  const { t, token } = await fresh()
  await call(t, 'setup.create-owner', { ...owner, token })
  const cookie = await t.signIn(owner.email, { totp: true })
  // Everyone behind the admin's proxy shares one address.
  const ip = '10.9.9.8'
  for (let i = 0; i < 10; i++) {
    await t.action('setup.save-shop', { ...shop, token: 'junk' }, { ip })
  }
  expect((await t.action('setup.save-shop', { ...shop, token: 'junk' }, { ip })).status).toBe(429)
  expect((await t.action('setup.save-shop', shop, { cookie, ip })).status).toBe(200)
})

test('an owner who lost the token can carry on signed in, after 2FA', async () => {
  const { t, token } = await fresh()
  await call(t, 'setup.create-owner', { ...owner, token })
  const cookie = await t.signIn(owner.email, { totp: true })
  expect((await t.action('setup.save-shop', shop, { cookie })).status).toBe(200)
  expect(await next(t)).toBe('modules')
})
