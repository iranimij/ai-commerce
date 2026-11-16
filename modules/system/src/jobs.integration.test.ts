import { createApp, defineJob, defineModule, jobs, provide, type Actor } from '@aicommerce/core'
import { coreMigrations, createPgJobQueue, createWorker, runMigrations } from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { z } from 'zod'
import { system } from './index.js'

let database: TestDb
let app: ReturnType<typeof createApp>
const admin: Actor = { type: 'admin', id: 'admin-1', permissions: new Set(['*']) }

const broken = defineJob({
  name: 'work.broken',
  module: 'work',
  description: 'Always fails',
  payload: z.strictObject({}),
  maxAttempts: 1,
  handler: () => Promise.reject(new Error('boom')),
})
const work = defineModule({ name: 'work', jobs: [broken] })

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations], { log: () => undefined })
  app = createApp({
    modules: [system, work],
    enabled: ['system', 'work'],
    services: [provide(jobs, 'app', createPgJobQueue(database))],
    transaction: database.transaction,
  })
})
afterAll(async () => {
  await database.drop()
})

test('job.retry moves a failed job back; a pending one is a conflict', async () => {
  const { id } = await app.service(jobs).enqueue(broken, {})
  const call = (name: string, input: unknown) => app.registry.call(name, input, { actor: admin })
  expect(await call('job.retry', { id })).toMatchObject({ ok: false, error: { code: 'conflict' } })
  await createWorker({ database, app, log: () => undefined }).runOnce()
  const failed = await call('job.list', { status: 'failed' })
  expect(failed).toMatchObject({
    ok: true,
    output: { items: [{ id, name: 'work.broken', status: 'failed', lastError: 'boom' }] },
  })
  expect(await call('job.retry', { id })).toMatchObject({ ok: true })
  const [row] = await database.client`select status, attempts from job where id = ${id}`
  expect(row).toEqual({ status: 'pending', attempts: 0 })
  expect(await call('job.retry', { id: crypto.randomUUID() })).toMatchObject({
    ok: false,
    error: { code: 'not_found' },
  })
})

test('job.list pages newest first', async () => {
  for (let i = 0; i < 3; i++) await app.service(jobs).enqueue(broken, {})
  const first = await app.registry.call('job.list', { limit: 2 }, { actor: admin })
  if (!first.ok) throw new Error(first.error.message)
  const page = first.output as { items: { id: string }[]; nextCursor: string | null }
  expect(page.items).toHaveLength(2)
  const second = await app.registry.call(
    'job.list',
    { limit: 2, cursor: page.nextCursor },
    { actor: admin },
  )
  expect(second.ok && (second.output as { items: unknown[] }).items.length).toBe(2)
})
