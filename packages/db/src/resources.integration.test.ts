import {
  attributeStore,
  createApp,
  defineModule,
  defineResource,
  provide,
  resourceStore,
  type Actor,
  type ResourceRecord,
  type Result,
  type Revision,
} from '@aicommerce/core'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { z } from 'zod'
import { createPgAttributeStore } from './attributes.js'
import { coreMigrations, runMigrations } from './migrate.js'
import { createPgResourceStore } from './resources.js'
import { createTestDb, type TestDb } from './test-db.js'

const gadget = defineResource({
  name: 'gadget',
  module: 'test',
  label: { singular: 'Gadget', plural: 'Gadgets' },
  fields: z.strictObject({
    code: z.string(),
    tags: z.array(z.string()),
    size: z.strictObject({ w: z.number(), h: z.number() }).optional(),
  }),
})
const testModule = defineModule({ name: 'test', resources: [gadget] })

let database: TestDb
let app: ReturnType<typeof createApp>
const admin: Actor = { type: 'admin', id: 'admin-1', permissions: new Set(['*']) }

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations], { log: () => undefined })
  await database.client`create table test_gadget (
    id uuid primary key,
    version integer not null,
    created_at timestamptz(3) not null,
    updated_at timestamptz(3) not null,
    attributes jsonb not null default '{}',
    code text not null unique,
    tags jsonb not null,
    size jsonb
  )`
  app = createApp({
    modules: [testModule],
    enabled: ['test'],
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
  await database.client`truncate test_gadget`
})

const call = (name: string, input: unknown) =>
  app.registry.call(name, input, { actor: admin, confirmed: true })

// A typed view of a call's output, for test assertions only.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function output<T = ResourceRecord>(result: Result<unknown>): T {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.output as T
}

test('structured fields round-trip through create, update, history and restore', async () => {
  const created = output(
    await call('gadget.create', {
      values: { code: 'a', tags: ['x', 'y'], size: { w: 2, h: 3 } },
    }),
  )
  expect(created).toMatchObject({ tags: ['x', 'y'], size: { w: 2, h: 3 } })
  expect(output(await call('gadget.get', { id: created.id }))).toEqual(created)
  const [row] = await database.client`select jsonb_typeof(tags) as t, size->>'w' as w
    from test_gadget where id = ${created.id}`
  expect(row).toEqual({ t: 'array', w: '2' })

  const updated = output(
    await call('gadget.update', { id: created.id, version: 1, values: { tags: ['z'] } }),
  )
  expect(updated).toMatchObject({ tags: ['z'], size: { w: 2, h: 3 } })

  const history = output<{ items: Revision[] }>(await call('gadget.history', { id: created.id }))
  const first = history.items.at(-1)
  expect(first?.after).toMatchObject({ tags: ['x', 'y'], size: { w: 2, h: 3 } })

  const restored = output(
    await call('gadget.restore', { revisionId: first?.id, version: updated.version }),
  )
  expect(restored).toMatchObject({ version: 3, tags: ['x', 'y'], size: { w: 2, h: 3 } })

  output(await call('gadget.delete', { id: created.id, version: 3 }))
  const back = output(await call('gadget.restore', { revisionId: first?.id }))
  expect(back).toMatchObject({ id: created.id, tags: ['x', 'y'], size: { w: 2, h: 3 } })
})

test('update replaces a structured field as a whole', async () => {
  const created = output(
    await call('gadget.create', { values: { code: 'a', tags: ['x'], size: { w: 2, h: 3 } } }),
  )
  const updated = output(
    await call('gadget.update', { id: created.id, version: 1, values: { size: { w: 5, h: 6 } } }),
  )
  expect(updated.size).toEqual({ w: 5, h: 6 })
  const partial = await call('gadget.update', {
    id: created.id,
    version: 2,
    values: { size: { w: 7 } },
  })
  expect(partial).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
})

test('a duplicate unique value is a conflict naming the field', async () => {
  output(await call('gadget.create', { values: { code: 'a', tags: [] } }))
  const twice = await call('gadget.create', { values: { code: 'a', tags: [] } })
  expect(twice).toMatchObject({ ok: false, error: { code: 'conflict' } })
  expect(!twice.ok && twice.error.message).toBe('Gadget with this code already exists')

  const other = output(await call('gadget.create', { values: { code: 'b', tags: [] } }))
  const renamed = await call('gadget.update', { id: other.id, version: 1, values: { code: 'a' } })
  expect(renamed).toMatchObject({ ok: false, error: { code: 'conflict' } })
  expect(!renamed.ok && renamed.error.message).toContain('code')

  // Restoring a deleted record whose code was taken meanwhile.
  output(await call('gadget.delete', { id: other.id, version: 1 }))
  output(await call('gadget.create', { values: { code: 'b', tags: [] } }))
  const history = output<{ items: Revision[] }>(await call('gadget.history', { id: other.id }))
  const restored = await call('gadget.restore', { revisionId: history.items.at(-1)?.id })
  expect(restored).toMatchObject({ ok: false, error: { code: 'conflict' } })
  expect(!restored.ok && restored.error.message).toContain('code')
})
