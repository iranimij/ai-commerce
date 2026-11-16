// The M0 contract: the sample third-party module, run through the real server, after every core change.
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createTestServer } from './testkit.js'

let t: Awaited<ReturnType<typeof createTestServer>>

beforeAll(async () => {
  t = await createTestServer()
})
afterAll(async () => {
  await t.stop()
  await t.database.drop()
})

const lastAudit = async (action: string) =>
  (
    await t.database.client`select outcome, actor_type from audit_log
      where action = ${action} order by id desc limit 1`
  )[0]

test('sample.greet is 200 for a guest and 400 for bad input, and both are audited', async () => {
  expect((await t.action('sample.greet', { name: 'Ada' })).status).toBe(200)
  expect(await lastAudit('sample.greet')).toEqual({ outcome: 'ok', actor_type: 'guest' })
  expect((await t.action('sample.greet', { name: '' })).status).toBe(400)
  expect(await lastAudit('sample.greet')).toEqual({ outcome: 'invalid_input', actor_type: 'guest' })
})

test('note.create is 403 for an admin without note.write, and audited', async () => {
  const admin = await t.signedIn([], true)
  expect(
    (await t.action('note.create', { values: { title: 'x' } }, { cookie: admin.cookie })).status,
  ).toBe(403)
  expect(await lastAudit('note.create')).toEqual({ outcome: 'forbidden', actor_type: 'admin' })
})

test('off and on keeps the notes', async () => {
  const owner = await t.signedIn(['owner'], true)
  const as = { cookie: owner.cookie }
  const created = (await (
    await t.action('note.create', { values: { title: 'Kept' } }, as)
  ).json()) as { output: { id: string } }
  const off = await t.action('module.disable', { name: 'sample' }, { ...as, confirmed: true })
  expect(off.status).toBe(200)
  expect(await t.until(async () => (await t.action('note.list', {}, as)).status === 404)).toBe(true)
  const [row] = await t.database
    .client`select title from sample_note where id = ${created.output.id}`
  expect(row?.title).toBe('Kept')
  expect((await t.action('module.enable', { name: 'sample' }, as)).status).toBe(200)
  expect(await t.until(async () => (await t.action('note.list', {}, as)).status === 200)).toBe(true)
  const back = (await (await t.action('note.get', { id: created.output.id }, as)).json()) as {
    output: { title: string }
  }
  expect(back.output.title).toBe('Kept')
})
