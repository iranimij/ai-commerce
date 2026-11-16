import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { settingRecordId } from '@aicommerce/core'
import { coreMigrations, encryptSecret, runMigrations } from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
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

test('restore warns when AICOMMERCE_SECRET_KEY does not match the backup', async () => {
  const key = randomBytes(32)
  const other = randomBytes(32).toString('base64')
  const token = encryptSecret(
    JSON.stringify('s3cret'),
    key,
    settingRecordId('sample.webhook-secret', null),
  )
  await database.client`insert into setting (key, encrypted) values ('sample.webhook-secret', ${token})`
  const secrets = join(dir, 'secrets.dump')
  expect(await run(['backup', '--out', secrets, '--schema', database.schema], io(true))).toBe(0)
  const restoreWith = async (secretKey: string) => {
    const err: string[] = []
    const code = await run(['restore', secrets, '--yes', '--schema', database.schema], {
      ...io(true),
      env: { ...process.env, AICOMMERCE_SECRET_KEY: secretKey },
      err: (l) => err.push(l),
    })
    return { code, err: err.join('\n') }
  }
  const wrong = await restoreWith(other)
  expect(wrong.code).toBe(0)
  expect(wrong.err).toContain('AICOMMERCE_SECRET_KEY does not match this backup')
  const right = await restoreWith(key.toString('base64'))
  expect(right.code).toBe(0)
  expect(right.err).toBe('')
})

test('restore of an older backup, then migrate, succeeds', async () => {
  const older = join(dir, 'older.dump')
  expect(await run(['backup', '--out', older, '--schema', database.schema], io(true))).toBe(0)
  // A newer migration, as a module update or a newly enabled module adds, after the backup.
  const newer = join(dir, 'newer')
  mkdirSync(newer)
  writeFileSync(join(newer, '0001_extra.sql'), 'create table extra (id integer primary key);\n')
  const sources = [coreMigrations, { module: 'extra', dir: newer }]
  await runMigrations(database, sources, { log: () => undefined })
  expect(await run(['restore', older, '--yes', '--schema', database.schema], io(true))).toBe(0)
  expect(await runMigrations(database, sources, { log: () => undefined })).toEqual([
    'extra/0001_extra.sql',
  ])
})

test('a failed restore changes nothing', async () => {
  // A backup whose table needs a type from another schema; without that type the load fails.
  const elsewhere = `${database.schema}_types`
  await database.client.unsafe(
    `create schema ${elsewhere}; create type ${elsewhere}.mood as enum ('ok')`,
  )
  await database.client.unsafe(`create table moody (m ${elsewhere}.mood)`)
  const needsType = join(dir, 'needs-type.dump')
  expect(await run(['backup', '--out', needsType, '--schema', database.schema], io(true))).toBe(0)
  await database.client.unsafe(`drop schema ${elsewhere} cascade`)
  await database.client`update setting set value = '"Current"' where key = 'shop.name'`
  await expect(
    run(['restore', needsType, '--yes', '--schema', database.schema], io(true)),
  ).resolves.toBe(1)
  expect(await titles()).toEqual(['Current'])
  expect(await database.client`select 1 from extra`).toEqual([])
  // A file cut short: pg_restore --list reads only its start, so the load is what fails.
  const cut = join(dir, 'cut.dump')
  const whole = readFileSync(file)
  writeFileSync(cut, whole.subarray(0, whole.length - 100))
  const err: string[] = []
  expect(
    await run(['restore', cut, '--yes', '--schema', database.schema], {
      ...io(true),
      err: (l) => err.push(l),
    }),
  ).toBe(1)
  expect(err.join('\n')).toContain('could not be read to the end')
  expect(await titles()).toEqual(['Current'])
  expect(await database.client`select 1 from extra`).toEqual([])
})
