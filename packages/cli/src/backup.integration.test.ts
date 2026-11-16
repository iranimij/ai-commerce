import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { coreMigrations, runMigrations } from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { run, type Io } from './main.js'

let database: TestDb
const dir = mkdtempSync(join(tmpdir(), 'aicommerce-backup-'))
const file = join(dir, 'shop.dump')
const asked: string[] = []
const io = (answer: boolean): Partial<Io> => ({
  out: () => undefined,
  err: () => undefined,
  ask: (question) => {
    asked.push(question)
    return Promise.resolve(answer)
  },
})
const titles = async () =>
  (await database.client`select value from setting where key = 'shop.name'`).map(
    (r): unknown => r.value,
  )

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations], { log: () => undefined })
  await database.client`insert into setting (key, value) values ('shop.name', '"Kept"')`
})
afterAll(async () => {
  await database.drop()
})

test('backup then restore brings the data back', async () => {
  expect(await run(['backup', '--out', file, '--schema', database.schema], io(true))).toBe(0)
  await database.client`delete from setting`
  expect(await titles()).toEqual([])
  expect(await run(['restore', file, '--yes', '--schema', database.schema], io(true))).toBe(0)
  expect(await titles()).toEqual(['Kept'])
  // The runtime role can use the restored tables again.
  const app = database.connectAsApp()
  expect((await app.client`select count(*)::int as n from setting`)[0]?.n).toBe(1)
})

test('restore refuses a file that is not a backup', async () => {
  const junk = join(dir, 'junk.dump')
  writeFileSync(junk, 'not a backup')
  const err: string[] = []
  expect(
    await run(['restore', junk, '--yes', '--schema', database.schema], {
      ...io(true),
      err: (l) => err.push(l),
    }),
  ).toBe(1)
  expect(err.join('\n')).toContain('not a backup')
  expect(await titles()).toEqual(['Kept'])
})

test('restore without --yes asks and stops on no', async () => {
  await database.client`update setting set value = '"Changed"' where key = 'shop.name'`
  asked.length = 0
  expect(await run(['restore', file, '--schema', database.schema], io(false))).toBe(1)
  expect(asked).toHaveLength(1)
  expect(asked[0]).toContain('replaces')
  expect(await titles()).toEqual(['Changed'])
})
