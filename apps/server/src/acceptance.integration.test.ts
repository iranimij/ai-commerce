// M0b "done when", end to end over HTTP with real sign-in, 2FA, PostgreSQL and the worker.
import { jobs } from '@aicommerce/core'
import { createWorker } from '@aicommerce/db'
import { greetLater } from '@aicommerce/module-sample'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { BASE, PASSWORD, createTestServer } from './testkit.js'

let t: Awaited<ReturnType<typeof createTestServer>>

beforeAll(async () => {
  t = await createTestServer()
})
afterAll(async () => {
  await t.database.drop()
})

async function ok<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { ok: boolean; output: T; error?: unknown }
  if (response.status !== 200)
    throw new Error(`${String(response.status)}: ${JSON.stringify(body)}`)
  return body.output
}

test('M0b: a shop can be run by an owner and an editor over HTTP', async () => {
  const { action, server } = t

  // A guest.
  expect((await action('sample.greet', { name: 'Ada' })).status).toBe(200)
  expect((await action('note.create', { values: { title: 'x' } })).status).toBe(401)
  expect((await action('sample.greet', { name: '' })).status).toBe(400)

  // The owner signs in with 2FA, creates a role and an admin.
  const owner = await t.signedIn(['owner'], true)
  const role = await ok<{ id: string }>(
    await action(
      'role.create',
      {
        name: 'Editors',
        permissions: [
          'note.read',
          'note.write',
          'note.delete',
          'attribute.read',
          'attribute.manage',
        ],
      },
      { cookie: owner.cookie },
    ),
  )
  const email = 'editor@example.com'
  await ok(
    await action(
      'admin.create',
      { email, name: 'Editor', password: PASSWORD, roles: [role.id] },
      { cookie: owner.cookie },
    ),
  )

  // The new admin turns on 2FA, then works on a note.
  const cookie = await t.signIn(email, { totp: true })
  const as = { cookie }
  const note = await ok<{ id: string; version: number }>(
    await action('note.create', { values: { title: 'Draft' } }, as),
  )
  await ok(await action('note.update', { id: note.id, version: 1, values: { title: 'Final' } }, as))
  expect(
    (await action('note.update', { id: note.id, version: 1, values: { title: 'Lost' } }, as))
      .status,
  ).toBe(409)
  await ok(
    await action(
      'attribute.create',
      {
        resource: 'note',
        code: 'colour',
        label: 'Colour',
        type: 'select',
        options: ['red', 'blue'],
      },
      as,
    ),
  )
  await ok(
    await action(
      'note.update',
      { id: note.id, version: 2, values: {}, attributes: { colour: 'red' } },
      as,
    ),
  )
  expect((await action('note.delete', { id: note.id, version: 3 }, as)).status).toBe(428)
  await ok(await action('note.delete', { id: note.id, version: 3 }, { ...as, confirmed: true }))
  const history = await ok<{ items: { id: string; action: string }[] }>(
    await action('note.history', { id: note.id }, as),
  )
  const lastEdit = history.items.find((r) => r.action === 'note.update')
  const restored = await ok<{ id: string; title: string; attributes: object }>(
    await action('note.restore', { revisionId: lastEdit?.id }, as),
  )
  expect(restored).toMatchObject({ id: note.id, title: 'Final', attributes: { colour: 'red' } })

  // A secret setting is stored encrypted.
  await ok(
    await action(
      'setting.set',
      { key: 'sample.webhook-secret', value: 'whsec_0123456789abcdef' },
      { cookie: owner.cookie },
    ),
  )
  const [secret] = await t.database.client`select value, encrypted from setting
    where key = 'sample.webhook-secret'`
  expect(secret?.value).toBeNull()
  expect(String(secret?.encrypted)).toMatch(/^v1\./)
  expect(JSON.stringify(secret)).not.toContain('whsec_')

  // A job runs in the worker.
  const { id: jobId } = await t.app.service(jobs).enqueue(greetLater, { name: 'Grace' })
  expect(
    await createWorker({ database: t.database, app: t.app, log: () => undefined }).runOnce(),
  ).toBe(1)
  const [job] = await t.database.client`select status from job where id = ${jobId}`
  expect(job?.status).toBe('done')

  // Every one of those calls has an audit row.
  const audited = new Set(
    (await t.database.client`select distinct action from audit_log`).map((r) => String(r.action)),
  )
  for (const name of [
    'sample.greet',
    'note.create',
    'role.create',
    'admin.create',
    'note.update',
    'attribute.create',
    'note.delete',
    'note.history',
    'note.restore',
    'setting.set',
  ]) {
    expect(audited, name).toContain(name)
  }
  const [byJob] = await t.database.client`select count(*)::int as n from audit_log
    where action = 'sample.greet' and actor_type = 'system'`
  expect(byJob?.n).toBe(1)

  // The OpenAPI document lists every enabled action.
  const doc = (await (await server.request(`${BASE}/api/openapi.json`)).json()) as {
    paths: Record<string, unknown>
  }
  expect(Object.keys(doc.paths).sort()).toEqual(
    t.app.registry
      .list()
      .map((a) => `/api/actions/${a.name}`)
      .sort(),
  )
})
