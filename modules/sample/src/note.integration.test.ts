import {
  createApp,
  guestActor,
  provide,
  resourceStore,
  type Actor,
  type ResourceRecord,
  type Result,
} from '@aicommerce/core'
import {
  coreMigrations,
  createDbAuditSink,
  createPgResourceStore,
  runMigrations,
} from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { sample, sampleMigrations } from './index.js'

let database: TestDb
let app: ReturnType<typeof createApp>
const admin: Actor = { type: 'admin', id: 'admin-1', permissions: new Set(['*']) }

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations, sampleMigrations], { log: () => undefined })
  app = createApp({
    modules: [sample],
    enabled: ['sample'],
    services: [provide(resourceStore, 'app', createPgResourceStore(database))],
    audit: createDbAuditSink(database),
    transaction: database.transaction,
    onError: () => undefined,
  })
})
afterAll(async () => {
  await database.drop()
})
beforeEach(async () => {
  await database.client`truncate sample_note`
})

const call = (name: string, input: unknown, actor: Actor = admin, confirmed = false) =>
  app.registry.call(name, input, { actor, confirmed })

// A typed view of a call's output, for test assertions only.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function output<T = ResourceRecord>(result: Result<unknown>): T {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.output as T
}

const create = async (title: string, pinned = false) =>
  output(await call('note.create', { values: { title, pinned } }))

test('create then get returns the same record at version 1', async () => {
  const created = await create('First')
  expect(created).toMatchObject({ title: 'First', pinned: false, version: 1, attributes: {} })
  expect(output(await call('note.get', { id: created.id }))).toEqual(created)
})

test('create writes a revision with before null and an audit row', async () => {
  const created = await create('Audited')
  const revisions = await database.client`select * from revision where record_id = ${created.id}`
  expect(revisions).toHaveLength(1)
  expect(revisions[0]).toMatchObject({ action: 'note.create', before: null, actor_id: 'admin-1' })
  expect((revisions[0]?.after as ResourceRecord).title).toBe('Audited')
  const [audit] = await database.client`select * from audit_log order by id desc limit 1`
  expect(audit).toMatchObject({ action: 'note.create', outcome: 'ok' })
})

test('list pages by cursor without gaps or repeats', async () => {
  for (let i = 0; i < 5; i++) await create(`Note ${String(i)}`)
  const seen: string[] = []
  let cursor: string | null = null
  let pages = 0
  do {
    const page: { items: ResourceRecord[]; nextCursor: string | null } = output(
      await call('note.list', { limit: 2, ...(cursor ? { cursor } : {}) }),
    )
    seen.push(...page.items.map((n) => n.id))
    cursor = page.nextCursor
    pages++
  } while (cursor)
  expect(pages).toBe(3)
  expect(new Set(seen).size).toBe(5)
})

test('list filters by field', async () => {
  await create('A', true)
  await create('B', true)
  await create('C', false)
  const page = output<{ items: ResourceRecord[] }>(
    await call('note.list', { filter: { pinned: true } }),
  )
  expect(page.items.map((n) => n.title).sort()).toEqual(['A', 'B'])
})

test('a bad cursor is invalid_input', async () => {
  expect(await call('note.list', { cursor: 'nonsense' })).toMatchObject({
    ok: false,
    error: { code: 'invalid_input', message: 'Invalid cursor' },
  })
})

test('update with a stale version is a conflict and changes nothing', async () => {
  const created = await create('Old')
  output(await call('note.update', { id: created.id, version: 1, values: { title: 'New' } }))
  const stale = await call('note.update', { id: created.id, version: 1, values: { title: 'Lost' } })
  expect(stale).toMatchObject({ ok: false, error: { code: 'conflict' } })
  expect(output(await call('note.get', { id: created.id }))).toMatchObject({
    title: 'New',
    version: 2,
  })
  const revisions = await database.client`select id from revision where record_id = ${created.id}`
  expect(revisions).toHaveLength(2)
})

test('an update does not reset fields it does not mention', async () => {
  const created = await create('Pinned', true)
  const updated = output(
    await call('note.update', { id: created.id, version: 1, values: { title: 'Still pinned' } }),
  )
  expect(updated).toMatchObject({ title: 'Still pinned', pinned: true })
})

test('concurrent updates from one version: exactly one wins', async () => {
  const created = await create('Race')
  const results = await Promise.all(
    ['X', 'Y'].map((title) =>
      call('note.update', { id: created.id, version: 1, values: { title } }),
    ),
  )
  expect(results.map((r) => (r.ok ? 'ok' : r.error.code)).sort()).toEqual(['conflict', 'ok'])
})

test('delete needs confirmation from an admin, then the record is gone', async () => {
  const created = await create('Doomed')
  expect(await call('note.delete', { id: created.id, version: 1 })).toMatchObject({
    ok: false,
    error: { code: 'confirmation_required' },
  })
  output(await call('note.delete', { id: created.id, version: 1 }, admin, true))
  expect(await call('note.get', { id: created.id })).toMatchObject({
    ok: false,
    error: { code: 'not_found' },
  })
})

test('history is newest first, and restore brings a deleted record back with its id', async () => {
  const created = await create('Draft')
  output(await call('note.update', { id: created.id, version: 1, values: { title: 'Final' } }))
  output(await call('note.delete', { id: created.id, version: 2 }, admin, true))
  const history = output<{ items: { id: string; action: string }[] }>(
    await call('note.history', { id: created.id }),
  )
  expect(history.items.map((r) => r.action)).toEqual(['note.delete', 'note.update', 'note.create'])
  const updateRevision = history.items[1]?.id ?? ''
  const restored = output(await call('note.restore', { revisionId: updateRevision }))
  expect(restored).toMatchObject({ id: created.id, title: 'Final' })
  expect(output(await call('note.get', { id: created.id }))).toMatchObject({ title: 'Final' })
})

test('a guest cannot create; bad input is invalid_input', async () => {
  expect(await call('note.create', { values: { title: 'x' } }, guestActor)).toMatchObject({
    ok: false,
    error: { code: 'forbidden' },
  })
  expect(await call('note.create', { values: { title: '' } })).toMatchObject({
    ok: false,
    error: { code: 'invalid_input' },
  })
})

test('revision rows cannot be updated or deleted', async () => {
  await create('Kept')
  await expect(database.client`update revision set action = 'x'`).rejects.toThrow('append-only')
  await expect(database.client`delete from revision`).rejects.toThrow('append-only')
})
