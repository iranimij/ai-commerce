import { afterAll, beforeAll, expect, test } from 'vitest'
import { createDb, type Database } from './client.js'
import { coreMigrations, runMigrations } from './migrate.js'
import { appRoleName, createTestDb } from './test-db.js'

let database: Awaited<ReturnType<typeof createTestDb>>
let app: Database

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations], { appRole: appRoleName(), log: () => undefined })
  app = database.connectAsApp()
})
afterAll(async () => {
  await database.drop()
})

test('the app role can insert audit rows', async () => {
  await expect(
    app.client`insert into audit_log (actor_type, action, input, outcome, duration_ms)
      values ('system', 'x.y', '{}'::jsonb, 'ok', 0)`,
  ).resolves.toBeDefined()
})

test('the app role cannot change or delete audit rows, even without the trigger', async () => {
  await database.client`alter table audit_log disable trigger audit_log_no_change`
  try {
    await expect(app.client`update audit_log set outcome = 'x'`).rejects.toThrow(
      'permission denied',
    )
    await expect(app.client`delete from audit_log`).rejects.toThrow('permission denied')
  } finally {
    await database.client`alter table audit_log enable trigger audit_log_no_change`
  }
})

test('the app role cannot alter tables', async () => {
  await expect(app.client`alter table audit_log disable trigger all`).rejects.toThrow(
    'must be owner',
  )
})

test('the app role cannot rewrite migration records', async () => {
  await expect(app.client`delete from migrations`).rejects.toThrow('permission denied')
})

test('migrating with a single-connection pool and an app role finishes', async () => {
  const single = createDb(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '', {
    max: 1,
    searchPath: database.schema,
  })
  try {
    await expect(
      runMigrations(single, [coreMigrations], { appRole: appRoleName(), log: () => undefined }),
    ).resolves.toEqual([])
  } finally {
    await single.close()
  }
}, 10_000)
