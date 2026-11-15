import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { runMigrations } from './migrate.js'
import { createTestDb } from './test-db.js'

let database: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  database = await createTestDb()
})
afterEach(async () => {
  await database.drop()
})

async function migrationDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'migrations-'))
  for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql)
  return dir
}

test('migrations apply once, in file-name order, and are recorded', async () => {
  const dir = await migrationDir({
    '0002_add_column.sql': 'alter table thing add column label text;',
    '0001_create.sql': 'create table thing (id int primary key);',
  })
  const first = await runMigrations(database, [{ module: 'demo', dir }])
  expect(first).toEqual(['demo/0001_create.sql', 'demo/0002_add_column.sql'])
  expect(await runMigrations(database, [{ module: 'demo', dir }])).toEqual([])
  const rows = await database.client`select module, name from migrations order by name`
  expect(rows.map((r) => `${String(r.module)}/${String(r.name)}`)).toEqual(first)
})

test('a failing migration rolls back and is not recorded', async () => {
  const dir = await migrationDir({
    '0001_bad.sql': 'create table half (id int); select * from no_such_table;',
  })
  await expect(runMigrations(database, [{ module: 'demo', dir }])).rejects.toThrow(
    'Migration demo/0001_bad.sql failed',
  )
  const tables = await database.client`
    select table_name from information_schema.tables
    where table_schema = ${database.schema} and table_name = 'half'`
  expect(tables).toHaveLength(0)
  expect(await database.client`select * from migrations`).toHaveLength(0)
})

test('migrations of different modules are tracked separately', async () => {
  const a = await migrationDir({ '0001_init.sql': 'create table a_thing (id int);' })
  const b = await migrationDir({ '0001_init.sql': 'create table b_thing (id int);' })
  expect(
    await runMigrations(database, [
      { module: 'a', dir: a },
      { module: 'b', dir: b },
    ]),
  ).toEqual(['a/0001_init.sql', 'b/0001_init.sql'])
})

test('two runs at the same time apply each migration once', async () => {
  const dir = await migrationDir({ '0001_create.sql': 'create table once (id int);' })
  const [x, y] = await Promise.all([
    runMigrations(database, [{ module: 'demo', dir }]),
    runMigrations(database, [{ module: 'demo', dir }]),
  ])
  expect([...x, ...y]).toEqual(['demo/0001_create.sql'])
})

test('a migration that loses its connection reports the migration, not the cleanup', async () => {
  const dir = await migrationDir({
    '0001_disconnect.sql': 'select pg_terminate_backend(pg_backend_pid());',
  })
  await expect(runMigrations(database, [{ module: 'demo', dir }])).rejects.toThrow(
    'Migration demo/0001_disconnect.sql failed',
  )
})
