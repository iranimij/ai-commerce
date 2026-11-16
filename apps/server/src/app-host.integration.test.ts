import { createAdminAuth } from '@aicommerce/auth'
import { systemActor } from '@aicommerce/core'
import { createDb, runMigrations } from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createAppHost, type AppHost } from './app-host.js'
import { migrationSources } from './wiring.js'

let database: TestDb
const hosts: AppHost[] = []
const stops: (() => Promise<void>)[] = []

const makeHost = async (owner = database, fallback = ['system', 'access']) => {
  const auth = createAdminAuth({
    database,
    baseURL: 'http://localhost:3000',
    secret: 'a-test-secret-that-is-long-enough-1234567890',
    trustedOrigins: ['http://localhost:3000'],
    production: false,
  })
  const host = await createAppHost({
    database,
    owner,
    secretKey: Buffer.alloc(32, 7),
    auth,
    fallback,
    onError: () => undefined,
  })
  hosts.push(host)
  return host
}

const tableExists = async (name: string) =>
  (await database.client`select to_regclass(${name}) is not null as ok`)[0]?.ok === true

const until = async (check: () => boolean | Promise<boolean>, ms = 2000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, migrationSources(['system', 'access']), { log: () => undefined })
})
afterAll(async () => {
  for (const stop of stops) await stop()
  await database.drop()
})

test('a fresh install runs the fallback modules plus the required ones', async () => {
  const host = await makeHost(database, ['sample'])
  expect(host.current().modules).toEqual(['system', 'access', 'sample', 'setup'])
})

test('enabling a module runs its migrations', async () => {
  await database.client`delete from module_state`
  await database.client`drop table if exists sample_note`
  await database.client`delete from migrations where module = 'sample'`
  const host = await makeHost()
  expect(await tableExists('sample_note')).toBe(false)
  expect(host.current().registry.get('sample.greet')).toBeUndefined()
  const result = await host
    .current()
    .registry.call('module.enable', { name: 'sample' }, { actor: systemActor })
  expect(result).toMatchObject({ ok: true })
  await host.reload()
  expect(await tableExists('sample_note')).toBe(true)
  expect(host.current().registry.get('sample.greet')).toBeDefined()
})

test('a module enabled in another process appears after the notification', async () => {
  await database.client`delete from module_state`
  const a = await makeHost()
  const b = await makeHost()
  stops.push(await b.listen())
  expect(b.current().registry.get('sample.greet')).toBeUndefined()
  await a.current().registry.call('module.enable', { name: 'sample' }, { actor: systemActor })
  expect(await until(() => b.current().registry.get('sample.greet') !== undefined)).toBe(true)
})

test('a reload that fails keeps the running app', async () => {
  const owner = createDb(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '', {
    max: 1,
    searchPath: database.schema,
  })
  const errors: unknown[] = []
  const host = await createAppHost({
    database,
    owner,
    secretKey: Buffer.alloc(32, 7),
    auth: createAdminAuth({
      database,
      baseURL: 'http://localhost:3000',
      secret: 'a-test-secret-that-is-long-enough-1234567890',
      trustedOrigins: ['http://localhost:3000'],
      production: false,
    }),
    fallback: ['system', 'access'],
    onError: (error) => errors.push(error),
  })
  const before = host.current()
  await owner.close()
  await host.reload()
  expect(host.current()).toBe(before)
  expect(errors).toHaveLength(1)
})
