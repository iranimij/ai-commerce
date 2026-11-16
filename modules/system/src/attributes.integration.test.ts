import {
  attributeStore,
  createApp,
  defineAttribute,
  defineModule,
  guestActor,
  provide,
  resourceStore,
  type Actor,
  type ResourceRecord,
  type Result,
} from '@aicommerce/core'
import {
  coreMigrations,
  createPgAttributeStore,
  createPgResourceStore,
  runMigrations,
} from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import { sample, sampleMigrations } from '@aicommerce/module-sample'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { system } from './index.js'

let database: TestDb
let app: ReturnType<typeof createApp>
const admin: Actor = { type: 'admin', id: 'admin-1', permissions: new Set(['*']) }

// A third-party module adding an attribute to another module's resource.
const extra = defineModule({
  name: 'extra',
  depends: ['sample'],
  attributes: [
    defineAttribute({
      resource: 'note',
      code: 'colour',
      label: 'Colour',
      type: 'select',
      options: ['red', 'blue'],
    }),
  ],
})

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations, sampleMigrations], { log: () => undefined })
  app = createApp({
    modules: [system, sample, extra],
    enabled: ['system', 'sample', 'extra'],
    services: [
      provide(resourceStore, 'app', createPgResourceStore(database)),
      provide(attributeStore, 'app', createPgAttributeStore(database)),
    ],
    transaction: database.transaction,
    onError: () => undefined,
  })
})
afterAll(async () => {
  await database.drop()
})
beforeEach(async () => {
  await database.client`truncate sample_note`
  await database.client`delete from attribute`
})

const call = (name: string, input: unknown, actor: Actor = admin, confirmed = false) =>
  app.registry.call(name, input, { actor, confirmed })

// A typed view of a call's output, for test assertions only.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function output<T = ResourceRecord>(result: Result<unknown>): T {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.output as T
}

const attribute = (code: string, extraFields: Record<string, unknown> = {}) =>
  call('attribute.create', { resource: 'note', code, label: code, type: 'text', ...extraFields })

test('a select attribute accepts its options and rejects others with a path', async () => {
  const ok = output(
    await call('note.create', { values: { title: 'A' }, attributes: { colour: 'red' } }),
  )
  expect(ok.attributes).toEqual({ colour: 'red' })
  const bad = await call('note.create', { values: { title: 'B' }, attributes: { colour: 'green' } })
  expect(bad).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  expect(!bad.ok && bad.error.issues?.[0]?.path).toEqual(['attributes', 'colour'])
})

test('an unknown attribute code is invalid_input', async () => {
  const result = await call('note.create', { values: { title: 'A' }, attributes: { size: 'L' } })
  expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  expect(!result.ok && result.error.issues?.[0]?.path).toEqual(['attributes', 'size'])
})

test('a required attribute must be given on create', async () => {
  output(await attribute('owner', { required: true }))
  const missing = await call('note.create', { values: { title: 'A' } })
  expect(missing).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  expect(!missing.ok && missing.error.issues?.[0]?.path).toEqual(['attributes', 'owner'])
  output(await call('note.create', { values: { title: 'A' }, attributes: { owner: 'Iman' } }))
})

test('update patches attributes and null removes one', async () => {
  output(await attribute('mood'))
  const created = output(
    await call('note.create', {
      values: { title: 'A' },
      attributes: { colour: 'red', mood: 'calm' },
    }),
  )
  const patched = output(
    await call('note.update', {
      id: created.id,
      version: 1,
      values: {},
      attributes: { mood: 'bold' },
    }),
  )
  expect(patched.attributes).toEqual({ colour: 'red', mood: 'bold' })
  const removed = output(
    await call('note.update', {
      id: created.id,
      version: 2,
      values: {},
      attributes: { colour: null },
    }),
  )
  expect(removed.attributes).toEqual({ mood: 'bold' })
})

test('list filters by attribute', async () => {
  output(await call('note.create', { values: { title: 'A' }, attributes: { colour: 'red' } }))
  output(await call('note.create', { values: { title: 'B' }, attributes: { colour: 'blue' } }))
  const page = output<{ items: ResourceRecord[] }>(
    await call('note.list', { attributes: { colour: 'blue' } }),
  )
  expect(page.items.map((n) => n.title)).toEqual(['B'])
  expect(await call('note.list', { attributes: { colour: 'green' } })).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  })
})

test('a module attribute cannot be deleted', async () => {
  expect(
    await call('attribute.delete', { resource: 'note', code: 'colour' }, admin, true),
  ).toMatchObject({
    ok: false,
    error: {
      code: 'forbidden',
      message: 'Attribute "colour" is defined by module "extra" and cannot be deleted',
    },
  })
  expect(await attribute('colour')).toMatchObject({ ok: false, error: { code: 'conflict' } })
})

test('deleting an attribute hides its values; recreating shows them', async () => {
  output(await attribute('mood'))
  const created = output(
    await call('note.create', { values: { title: 'A' }, attributes: { mood: 'calm' } }),
  )
  output(await call('attribute.delete', { resource: 'note', code: 'mood' }, admin, true))
  expect(output(await call('note.get', { id: created.id })).attributes).toEqual({})
  output(await attribute('mood'))
  expect(output(await call('note.get', { id: created.id })).attributes).toEqual({ mood: 'calm' })
})

test('a guest cannot create attributes; an unknown resource is invalid_input', async () => {
  expect(
    await call(
      'attribute.create',
      { resource: 'note', code: 'x', label: 'X', type: 'text' },
      guestActor,
    ),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  expect(
    await call('attribute.create', { resource: 'nope', code: 'x', label: 'X', type: 'text' }),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
})

test('attribute.list shows module and merchant attributes', async () => {
  output(await attribute('mood'))
  const list = output<{ items: { code: string; source: string }[] }>(
    await call('attribute.list', { resource: 'note' }),
  )
  expect(list.items.map((a) => [a.code, a.source])).toEqual([
    ['colour', 'module'],
    ['mood', 'merchant'],
  ])
})
