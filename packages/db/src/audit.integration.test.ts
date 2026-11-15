import { createRegistry, defineAction, guestActor, type Actor } from '@aicommerce/core'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { z } from 'zod'
import { createDbAuditSink } from './audit.js'
import { coreMigrations, runMigrations } from './migrate.js'
import { createTestDb } from './test-db.js'

let database: Awaited<ReturnType<typeof createTestDb>>
const admin: Actor = { type: 'admin', id: 'admin-1', permissions: new Set(['*']) }

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations])
  await database.client`create table note (body text not null)`
})
afterAll(async () => {
  await database.drop()
})

function registry() {
  const r = createRegistry({
    audit: createDbAuditSink(database),
    transaction: database.transaction,
  })
  r.register(
    defineAction({
      name: 'note.add',
      description: 'Add a note',
      input: z.object({ body: z.string(), password: z.string().optional() }),
      output: z.object({}),
      permission: 'note.add',
      risk: 'write',
      redact: ['password'],
      handler: async (input) => {
        await database.current().execute(sql`insert into note (body) values (${input.body})`)
        if (input.body === 'fail') throw new Error('after writing')
        return {}
      },
    }),
  )
  return r
}

async function lastEntry() {
  const [row] = await database.client`select * from audit_log order by id desc limit 1`
  return row
}

test('a successful call writes one row with outcome ok', async () => {
  await registry().call('note.add', { body: 'hello' }, { actor: admin })
  expect(await lastEntry()).toMatchObject({
    actor_type: 'admin',
    actor_id: 'admin-1',
    action: 'note.add',
    outcome: 'ok',
    input: { body: 'hello' },
  })
})

test('a forbidden call is audited', async () => {
  await registry().call('note.add', { body: 'x' }, { actor: guestActor })
  expect(await lastEntry()).toMatchObject({ actor_type: 'guest', outcome: 'forbidden' })
})

test('an invalid call is audited', async () => {
  await registry().call('note.add', { body: 1 }, { actor: admin })
  expect(await lastEntry()).toMatchObject({ outcome: 'invalid_input', input: { body: 1 } })
})

test('a throwing handler rolls back its writes but is audited as handler_error', async () => {
  const before = await database.client`select count(*)::int as n from note`
  await registry().call('note.add', { body: 'fail' }, { actor: admin })
  const after = await database.client`select count(*)::int as n from note`
  expect(after[0]?.n).toBe(before[0]?.n)
  expect(await lastEntry()).toMatchObject({ outcome: 'handler_error' })
})

test('redacted keys are stored as [redacted]', async () => {
  await registry().call('note.add', { body: 'x', password: 'hunter2' }, { actor: admin })
  expect((await lastEntry())?.input).toEqual({ body: 'x', password: '[redacted]' })
})

test('the AI acting for an admin records on_behalf_of', async () => {
  await registry().call('note.add', { body: 'x' }, { actor: { ...admin, onBehalfOf: 'admin-1' } })
  expect(await lastEntry()).toMatchObject({ on_behalf_of: 'admin-1' })
})

test('audit rows cannot be updated, deleted or truncated', async () => {
  // Row triggers only fire when there are rows, so make sure there is one.
  await registry().call('note.add', { body: 'kept' }, { actor: admin })
  await expect(database.client`update audit_log set outcome = 'ok'`).rejects.toThrow(
    'audit_log is append-only',
  )
  await expect(database.client`delete from audit_log`).rejects.toThrow('audit_log is append-only')
  await expect(database.client`truncate audit_log`).rejects.toThrow('audit_log is append-only')
  expect((await database.client`select count(*)::int as n from audit_log`)[0]?.n).toBeGreaterThan(0)
})
