import { randomBytes } from 'node:crypto'
import {
  createApp,
  defineModule,
  defineSetting,
  provide,
  settings,
  settingStore,
  type Actor,
  type Result,
} from '@aicommerce/core'
import { coreMigrations, createDbAuditSink, createPgSettings, runMigrations } from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { system } from './index.js'

let database: TestDb
let app: ReturnType<typeof createApp>
const onError = vi.fn()
const admin: Actor = { type: 'admin', id: 'admin-1', permissions: new Set(['*']) }
const settingsAdmin: Actor = {
  type: 'admin',
  id: 'admin-2',
  permissions: new Set(['setting.read', 'setting.manage']),
}

const apiKey = defineSetting({
  key: 'pay.api-key',
  module: 'pay',
  label: 'API key',
  schema: z.string().min(1),
  privacy: 'secret',
  scope: 'channel',
  permission: 'pay.manage',
})
const otherKey = defineSetting({ ...apiKey, key: 'pay.other-key', label: 'Other key' })
const limit = defineSetting({
  key: 'pay.limit',
  module: 'pay',
  label: 'Limit',
  schema: z.number().int().min(1),
  default: 100,
  privacy: 'internal',
  scope: 'global',
})
const pay = defineModule({ name: 'pay', settings: [apiKey, otherKey, limit] })

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations], { log: () => undefined })
  const pg = createPgSettings(database, { secretKey: randomBytes(32), onError })
  app = createApp({
    modules: [system, pay],
    enabled: ['system', 'pay'],
    services: [provide(settings, 'app', pg.reader), provide(settingStore, 'app', pg.store)],
    audit: createDbAuditSink(database),
    transaction: database.transaction,
    onError: () => undefined,
  })
})
afterAll(async () => {
  await database.drop()
})
beforeEach(async () => {
  await database.client`delete from setting`
  onError.mockClear()
})

const call = (name: string, input: unknown, actor: Actor = admin) =>
  app.registry.call(name, input, { actor })

// A typed view of a call's output, for test assertions only.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function output<T>(result: Result<unknown>): T {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.output as T
}

test('a secret is stored encrypted', async () => {
  output(await call('setting.set', { key: 'pay.api-key', value: 'sk_live_123' }))
  const [row] = await database.client`select * from setting where key = 'pay.api-key'`
  expect(row?.value).toBeNull()
  expect(JSON.stringify(row)).not.toContain('sk_live_123')
  expect(await app.service(settings).get(apiKey)).toBe('sk_live_123')
})

test('a secret is never returned by setting.list or setting.history', async () => {
  output(await call('setting.set', { key: 'pay.api-key', value: 'sk_live_123' }))
  output(await call('setting.set', { key: 'pay.api-key', value: 'sk_live_456' }))
  const list = output<{ items: { key: string; isSet: boolean }[] }>(
    await call('setting.list', { module: 'pay' }),
  )
  const item = list.items.find((i) => i.key === 'pay.api-key')
  expect(item).toMatchObject({ isSet: true, isDefault: false })
  expect(item).not.toHaveProperty('value')
  const history = await call('setting.history', { key: 'pay.api-key' })
  expect(JSON.stringify(history)).not.toMatch(/sk_live/)
  expect(JSON.stringify(history)).toContain('[secret]')
})

test('a ciphertext copied to another key cannot be read', async () => {
  output(await call('setting.set', { key: 'pay.api-key', value: 'sk_live_123' }))
  await database.client`insert into setting (key, encrypted)
    select 'pay.other-key', encrypted from setting where key = 'pay.api-key'`
  expect(await app.service(settings).get(otherKey)).toBeUndefined()
  expect(onError).toHaveBeenCalledTimes(1)
})

test('a channel value is used for that channel only', async () => {
  output(await call('setting.set', { key: 'pay.api-key', value: 'global' }))
  output(await call('setting.set', { key: 'pay.api-key', value: 'german', channel: 'de' }))
  expect(await app.service(settings).get(apiKey, { channel: 'de' })).toBe('german')
  expect(await app.service(settings).get(apiKey, { channel: 'fr' })).toBe('global')
  expect(await call('setting.set', { key: 'pay.limit', value: 5, channel: 'de' })).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  })
})

test('an invalid value is invalid_input at value', async () => {
  const result = await call('setting.set', { key: 'pay.limit', value: 0 })
  expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  expect(!result.ok && result.error.issues?.[0]?.path).toEqual(['value'])
})

test('an unknown key is not_found', async () => {
  expect(await call('setting.set', { key: 'pay.nope', value: 1 })).toMatchObject({
    ok: false,
    error: { code: 'not_found' },
  })
})

test('a setting with its own permission needs it', async () => {
  expect(
    await call('setting.set', { key: 'pay.api-key', value: 'x' }, settingsAdmin),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  output(await call('setting.set', { key: 'pay.limit', value: 5 }, settingsAdmin))
})

test('the audit row never contains the value', async () => {
  output(await call('setting.set', { key: 'pay.limit', value: 4242 }))
  const [row] = await database.client`select input from audit_log
    where action = 'setting.set' order by id desc limit 1`
  expect(row?.input).toEqual({ key: 'pay.limit', value: '[redacted]' })
})

test('history shows who changed what, newest first; reset brings back the default', async () => {
  output(await call('setting.set', { key: 'pay.limit', value: 5 }))
  output(await call('setting.set', { key: 'pay.limit', value: 7 }, settingsAdmin))
  output(await call('setting.reset', { key: 'pay.limit' }))
  expect(await app.service(settings).get(limit)).toBe(100)
  const history = output<{ items: { actorId: string; action: string; after: unknown }[] }>(
    await call('setting.history', { key: 'pay.limit', limit: 3 }),
  )
  expect(history.items.map((r) => [r.action, r.actorId])).toEqual([
    ['setting.reset', 'admin-1'],
    ['setting.set', 'admin-2'],
    ['setting.set', 'admin-1'],
  ])
  expect(history.items[1]?.after).toMatchObject({ value: 7 })
})
