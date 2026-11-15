import { afterAll, beforeAll, expect, test } from 'vitest'
import { coreMigrations, runMigrations } from './migrate.js'
import { createRateLimiter } from './rate-limit.js'
import { createTestDb } from './test-db.js'

let database: Awaited<ReturnType<typeof createTestDb>>
const rule = { limit: 3, windowSeconds: 60 }

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations], { log: () => undefined })
})
afterAll(async () => {
  await database.drop()
})

test('allows up to the limit in a window, then refuses with retryAfterSeconds > 0', async () => {
  const limiter = createRateLimiter(database)
  const results = []
  for (let i = 0; i < 4; i++) results.push(await limiter.hit('ip:1', rule))
  expect(results.map((r) => r.allowed)).toEqual([true, true, true, false])
  expect(results[3]?.retryAfterSeconds).toBeGreaterThan(0)
})

test('separate keys are independent', async () => {
  const limiter = createRateLimiter(database)
  for (let i = 0; i < 3; i++) await limiter.hit('ip:2', rule)
  expect((await limiter.hit('ip:3', rule)).allowed).toBe(true)
})

test('a new window allows again', async () => {
  const limiter = createRateLimiter(database)
  for (let i = 0; i < 4; i++) await limiter.hit('ip:4', rule)
  await database.client`update rate_limit set window_start = window_start - interval '1 hour' where key = 'ip:4'`
  expect((await limiter.hit('ip:4', rule)).allowed).toBe(true)
  const rows = await database.client`select count(*)::int as n from rate_limit where key = 'ip:4'`
  expect(rows[0]?.n).toBe(1)
})
