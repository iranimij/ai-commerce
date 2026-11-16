import {
  createApp,
  defineAction,
  defineModule,
  moduleState,
  provide,
  type Actor,
} from '@aicommerce/core'
import {
  coreMigrations,
  createDbAuditSink,
  createPgModuleState,
  MODULES_CHANNEL,
  runMigrations,
} from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { z } from 'zod'
import { system } from './index.js'

let database: TestDb
let app: ReturnType<typeof createApp>
const admin: Actor = { type: 'admin', id: 'admin-1', permissions: new Set(['*']) }

const failAfterSet = defineAction({
  name: 'broken.set-then-fail',
  description: 'Writes module state, then fails',
  input: z.object({}),
  output: z.object({}),
  permission: null,
  risk: 'write',
  handler: async (_input, ctx) => {
    await ctx
      .service(moduleState)
      .set(['system'], { action: 'broken.set-then-fail', actor: ctx.actor })
    throw new Error('after set')
  },
})
const modules = [
  system,
  defineModule({ name: 'catalog', label: 'Catalog' }),
  defineModule({ name: 'cart', label: 'Cart', depends: ['catalog'] }),
  defineModule({ name: 'broken', actions: [failAfterSet] }),
]

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations], { log: () => undefined })
  app = createApp({
    modules,
    enabled: ['system', 'broken'],
    services: [provide(moduleState, 'app', createPgModuleState(database))],
    transaction: database.transaction,
    audit: createDbAuditSink(database),
    onError: () => undefined,
  })
})
afterAll(async () => {
  await database.drop()
})
beforeEach(async () => {
  await database.client`delete from module_state`
})

const call = (name: string, input: unknown, confirmed = false) =>
  app.registry.call(name, input, { actor: admin, confirmed })

test('module.list shows every known module, enabled or not', async () => {
  const result = await call('module.list', {})
  expect(result).toMatchObject({ ok: true })
  const items = (result as { output: { name: string; enabled: boolean; required: boolean }[] })
    .output
  expect(items.map((m) => [m.name, m.enabled, m.required])).toEqual([
    ['system', true, true],
    ['catalog', false, false],
    ['cart', false, false],
    ['broken', true, false],
  ])
})

test('module.enable enables dependencies and lists them in added', async () => {
  expect(await call('module.enable', { name: 'cart' })).toMatchObject({
    ok: true,
    output: {
      enabled: ['system', 'catalog', 'cart', 'broken'],
      added: [{ module: 'catalog', requiredBy: 'cart' }],
    },
  })
  expect(await app.service(moduleState).enabled()).toEqual(['system', 'catalog', 'cart', 'broken'])
})

test('disabling a needed module names its dependents', async () => {
  await call('module.enable', { name: 'cart' })
  const result = await call('module.disable', { name: 'catalog' }, true)
  expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } })
  expect(JSON.stringify(result)).toContain('cart')
  expect(await call('module.disable', { name: 'cart' }, true)).toMatchObject({
    ok: true,
    output: { enabled: ['system', 'catalog', 'broken'] },
  })
})

test('a required module cannot be disabled', async () => {
  expect(await call('module.disable', { name: 'system' }, true)).toMatchObject({
    ok: false,
    error: { code: 'conflict', message: 'Module "system" is required and cannot be disabled' },
  })
})

test('module.disable asks for confirmation; an unknown module is not_found', async () => {
  expect(await call('module.disable', { name: 'broken' })).toMatchObject({
    ok: false,
    error: { code: 'confirmation_required' },
  })
  expect(await call('module.enable', { name: 'nope' })).toMatchObject({
    ok: false,
    error: { code: 'not_found' },
  })
})

test('set notifies aicommerce_modules only on commit', async () => {
  const heard: string[] = []
  // The channel spans the database; other test files switch modules in their own schemas.
  const listener = await database.client.listen(MODULES_CHANNEL, (payload) => {
    if (payload === database.schema) heard.push(payload)
  })
  try {
    await call('broken.set-then-fail', {})
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(heard).toEqual([])
    expect(await app.service(moduleState).enabled()).toBeNull()
    await call('module.enable', { name: 'catalog' })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(heard).toHaveLength(1)
  } finally {
    await listener.unlisten()
  }
})

test('module changes have revisions and audit rows', async () => {
  await call('module.enable', { name: 'catalog' })
  const [revision] = await database.client`select after from revision
    where resource = 'module' order by id desc limit 1`
  expect(revision?.after).toMatchObject({ enabled: ['system', 'catalog', 'broken'] })
  const [audit] = await database.client`select outcome from audit_log
    where action = 'module.enable' order by id desc limit 1`
  expect(audit?.outcome).toBe('ok')
})
