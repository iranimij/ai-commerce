import {
  createApp,
  defineAction,
  defineJob,
  defineModule,
  jobs,
  provide,
  systemActor,
} from '@aicommerce/core'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { z } from 'zod'
import { createPgJobQueue, createWorker } from './jobs.js'
import { coreMigrations, runMigrations } from './migrate.js'
import { createTestDb, type TestDb } from './test-db.js'

let database: TestDb
let queue: ReturnType<typeof createPgJobQueue>
let app: ReturnType<typeof createApp>
const runs: string[] = []
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const ok = defineJob({
  name: 'work.ok',
  module: 'work',
  description: 'Records its tag',
  payload: z.strictObject({ tag: z.string() }),
  handler: async (payload) => {
    await pause(5)
    runs.push(payload.tag)
  },
})
const flaky = defineJob({
  name: 'work.flaky',
  module: 'work',
  description: 'Fails on its first attempt',
  payload: z.strictObject({}),
  handler: (_payload, ctx) => {
    if (ctx.attempt === 1) return Promise.reject(new Error('first try'))
    runs.push('flaky')
    return Promise.resolve()
  },
})
const broken = defineJob({
  name: 'work.broken',
  module: 'work',
  description: 'Always fails',
  payload: z.strictObject({}),
  maxAttempts: 2,
  handler: () => Promise.reject(new Error('boom')),
})
const enqueueThenFail = defineAction({
  name: 'work.enqueue-then-fail',
  description: 'Enqueues a job, then fails',
  input: z.object({}),
  output: z.object({}),
  permission: null,
  risk: 'write',
  handler: async (_input, ctx) => {
    await ctx.service(jobs).enqueue(ok, { tag: 'never' })
    throw new Error('after enqueue')
  },
})
const slow = defineJob({
  name: 'slow.wait',
  module: 'slow',
  description: 'Takes three seconds',
  payload: z.strictObject({}),
  timeoutSeconds: 300,
  handler: async () => {
    await pause(3000)
  },
})
const work = defineModule({ name: 'work', jobs: [ok, flaky, broken], actions: [enqueueThenFail] })

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations], { log: () => undefined })
  queue = createPgJobQueue(database)
  app = createApp({
    modules: [work],
    enabled: ['work'],
    services: [provide(jobs, 'app', queue)],
    transaction: database.transaction,
    onError: () => undefined,
  })
})
afterAll(async () => {
  await database.drop()
})
beforeEach(async () => {
  runs.length = 0
  await database.client`delete from job`
})

const worker = (concurrency = 4) =>
  createWorker({ database, app, concurrency, log: () => undefined })
const job = async (id: string) => (await database.client`select * from job where id = ${id}`)[0]
const due = (id: string) =>
  database.client`update job set run_at = now() - interval '1 second' where id = ${id}`

test('a job enqueued in a rolled-back call never exists', async () => {
  const result = await app.registry.call('work.enqueue-then-fail', {}, { actor: systemActor })
  expect(result).toMatchObject({ ok: false, error: { code: 'handler_error' } })
  expect(await database.client`select id from job`).toHaveLength(0)
})

test('a bad payload throws at enqueue', async () => {
  await expect(queue.enqueue(ok, { tag: 1 } as never)).rejects.toThrow()
})

test('a job runs once and is done', async () => {
  const { id } = await queue.enqueue(ok, { tag: 'a' })
  expect(await worker().runOnce()).toBe(1)
  expect(await worker().runOnce()).toBe(0)
  expect(runs).toEqual(['a'])
  expect(await job(id)).toMatchObject({ status: 'done', attempts: 1 })
})

test('a failing job is retried with backoff, then succeeds', async () => {
  const { id } = await queue.enqueue(flaky, {})
  await worker().runOnce()
  const [row] = await database.client`select status, attempts, last_error,
    extract(epoch from run_at - now())::float as wait from job where id = ${id}`
  expect(row).toMatchObject({ status: 'pending', attempts: 1, last_error: 'first try' })
  expect(row?.wait).toBeGreaterThan(8)
  expect(row?.wait).toBeLessThanOrEqual(10)
  expect(await worker().runOnce()).toBe(0)
  await due(id)
  await worker().runOnce()
  expect(await job(id)).toMatchObject({ status: 'done', attempts: 2 })
  expect(runs).toEqual(['flaky'])
})

test('a job failing every attempt ends failed with its error', async () => {
  const { id } = await queue.enqueue(broken, {})
  await worker().runOnce()
  await due(id)
  await worker().runOnce()
  expect(await job(id)).toMatchObject({ status: 'failed', attempts: 2, last_error: 'boom' })
})

test('two workers never run the same job', async () => {
  for (let i = 0; i < 10; i++) await queue.enqueue(ok, { tag: String(i) })
  const counts = await Promise.all([worker(10).runOnce(), worker(10).runOnce()])
  expect(counts[0] + counts[1]).toBe(10)
  expect(runs.sort()).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
})

test('a job stuck running past its timeout is picked up again', async () => {
  const { id } = await queue.enqueue(ok, { tag: 'stuck' })
  await database.client`update job set status = 'running', attempts = 1,
    locked_at = now() - interval '1 hour', locked_by = 'dead-worker' where id = ${id}`
  expect(await worker().runOnce()).toBe(1)
  expect(await job(id)).toMatchObject({ status: 'done', attempts: 2 })
})

test('a duplicate key while pending is reported, not enqueued', async () => {
  const first = await queue.enqueue(ok, { tag: 'k' }, { key: 'nightly' })
  const second = await queue.enqueue(ok, { tag: 'k' }, { key: 'nightly' })
  expect(second).toEqual({ id: first.id, duplicate: true })
  expect(await database.client`select id from job`).toHaveLength(1)
  await worker().runOnce()
  expect((await queue.enqueue(ok, { tag: 'k' }, { key: 'nightly' })).duplicate).toBe(false)
})

test('a job of a disabled module waits', async () => {
  const { id } = await queue.enqueue(ok, { tag: 'later' })
  const without = createApp({ modules: [work], enabled: [] })
  expect(await createWorker({ database, app: without, log: () => undefined }).runOnce()).toBe(0)
  expect(await job(id)).toMatchObject({ status: 'pending', attempts: 0 })
})

test('start and stop run jobs in the background', async () => {
  await queue.enqueue(ok, { tag: 'bg' })
  const w = createWorker({ database, app, pollIntervalMs: 20, log: () => undefined })
  w.start()
  await expect.poll(() => runs).toEqual(['bg'])
  await w.stop()
})

test('a job is due as soon as it is enqueued', async () => {
  // run_at is stored to the millisecond; rounding up would put a new job just in the future.
  for (let i = 0; i < 40; i++) {
    await queue.enqueue(ok, { tag: String(i) })
    expect(await worker().runOnce()).toBe(1)
  }
})

test('the in-process timeout is the one stored on the job, not the current definition', async () => {
  const slowApp = createApp({
    modules: [defineModule({ name: 'slow', jobs: [slow] })],
    enabled: ['slow'],
    services: [provide(jobs, 'app', queue)],
  })
  // Enqueued before a deploy raised the timeout to 300 s.
  const { id } = await queue.enqueue({ ...slow, timeoutSeconds: 1 }, {})
  const started = Date.now()
  await createWorker({ database, app: slowApp, log: () => undefined }).runOnce()
  expect(Date.now() - started).toBeLessThan(2500)
  expect(String((await job(id))?.last_error)).toContain('Timed out after 1 s')
}, 10_000)

test('a running job is left alone until 30 s past its timeout', async () => {
  const { id } = await queue.enqueue(ok, { tag: 'busy' })
  await database.client`update job set status = 'running', attempts = 1,
    locked_at = now() - interval '310 seconds', locked_by = 'busy-worker' where id = ${id}`
  expect(await worker().runOnce()).toBe(0)
  expect(await job(id)).toMatchObject({ status: 'running', locked_by: 'busy-worker' })
})
