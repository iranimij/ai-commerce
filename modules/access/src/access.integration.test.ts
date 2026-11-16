import { authMigrations, createAdminAuth, identity } from '@aicommerce/auth'
import { createApp, provide, type Actor, type Result } from '@aicommerce/core'
import { coreMigrations, createDbAuditSink, databaseService, runMigrations } from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import { sample, sampleMigrations } from '@aicommerce/module-sample'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { access } from './index.js'

const PASSWORD = 'correct horse battery'
let database: TestDb
let app: ReturnType<typeof createApp>
let owner: Actor
let manager: Actor

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations, authMigrations, sampleMigrations], {
    log: () => undefined,
  })
  const auth = createAdminAuth({
    database,
    baseURL: 'http://localhost:3000',
    secret: 'a-test-secret-that-is-long-enough-1234567890',
    trustedOrigins: ['http://localhost:3000'],
    production: false,
  })
  app = createApp({
    modules: [access, sample],
    enabled: ['access', 'sample'],
    services: [provide(identity, 'app', auth.identity), provide(databaseService, 'app', database)],
    audit: createDbAuditSink(database),
    transaction: database.transaction,
    onError: () => undefined,
  })
})
afterAll(async () => {
  await database.drop()
})

let n = 0
const user = async (roles: string[]) => {
  const { id } = await app.service(identity).createAdmin({
    email: `user${String(n++)}@example.com`,
    name: 'User',
    password: PASSWORD,
  })
  for (const role of roles) {
    await database.client`insert into admin_user_role (user_id, role_id) values (${id}, ${role})`
  }
  return id
}

beforeEach(async () => {
  await database.client`delete from admin_user`
  await database.client`delete from admin_role where not system`
  owner = { type: 'admin', id: await user(['owner']), permissions: new Set(['*']) }
  manager = {
    type: 'admin',
    id: await user([]),
    permissions: new Set(['role.read', 'role.manage', 'admin.read', 'admin.manage', 'note.read']),
  }
})

const call = (name: string, input: unknown, actor: Actor = owner) =>
  app.registry.call(name, input, { actor, confirmed: true })

// A typed view of a call's output, for test assertions only.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function output<T>(result: Result<unknown>): T {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.output as T
}

const newAdmin = (roles: string[], actor: Actor = owner) =>
  call(
    'admin.create',
    { email: `new${String(n++)}@example.com`, name: 'New', password: PASSWORD, roles },
    actor,
  )

test('an admin cannot grant a permission they lack', async () => {
  expect(
    await call('role.create', { name: 'Writers', permissions: ['note.write'] }, manager),
  ).toMatchObject({
    ok: false,
    error: { code: 'forbidden', message: 'You cannot grant permissions you do not have' },
  })
  const readers = output<{ id: string }>(
    await call('role.create', { name: 'Readers', permissions: ['note.read'] }, manager),
  )
  const writers = output<{ id: string }>(
    await call('role.create', { name: 'Writers', permissions: ['note.write'] }),
  )
  expect(await newAdmin([writers.id], manager)).toMatchObject({ error: { code: 'forbidden' } })
  output(await newAdmin([readers.id], manager))
  expect(
    await call('role.update', { id: writers.id, permissions: ['note.read'] }, manager),
  ).toMatchObject({ error: { code: 'forbidden' } })
})

test('only an owner can grant the owner role', async () => {
  expect(await newAdmin(['owner'], manager)).toMatchObject({ error: { code: 'forbidden' } })
  expect(await call('role.create', { name: 'All', permissions: ['*'] }, manager)).toMatchObject({
    error: { code: 'forbidden' },
  })
  output(await newAdmin(['owner']))
})

test('unknown permissions and unknown roles are invalid_input', async () => {
  expect(await call('role.create', { name: 'X', permissions: ['nope.do'] })).toMatchObject({
    error: { code: 'invalid_input' },
  })
  expect(await newAdmin(['no-such-role'])).toMatchObject({ error: { code: 'invalid_input' } })
})

test('the owner role cannot be changed or deleted', async () => {
  expect(await call('role.update', { id: 'owner', name: 'Boss' })).toMatchObject({
    error: { code: 'forbidden' },
  })
  expect(await call('role.delete', { id: 'owner' })).toMatchObject({ error: { code: 'forbidden' } })
})

test('a role in use cannot be deleted', async () => {
  const role = output<{ id: string }>(
    await call('role.create', { name: 'Readers', permissions: ['note.read'] }),
  )
  output(await newAdmin([role.id]))
  expect(await call('role.delete', { id: role.id })).toMatchObject({ error: { code: 'conflict' } })
})

test('the last owner cannot be demoted or disabled', async () => {
  const other: Actor = { type: 'admin', id: manager.id, permissions: new Set(['*']) }
  expect(await call('admin.set-roles', { id: owner.id, roles: [] }, other)).toMatchObject({
    error: { code: 'conflict' },
  })
  expect(await call('admin.disable', { id: owner.id, disabled: true }, other)).toMatchObject({
    error: { code: 'conflict' },
  })
  output(await call('admin.set-roles', { id: manager.id, roles: ['owner'] }))
  output(await call('admin.set-roles', { id: owner.id, roles: [] }, other))
})

test('disabling yourself is a conflict', async () => {
  expect(await call('admin.disable', { id: owner.id, disabled: true })).toMatchObject({
    error: { code: 'conflict' },
  })
})

test('disabling an admin ends their sessions', async () => {
  const id = await user([])
  await database.client`insert into admin_session (id, expires_at, token, created_at, updated_at, user_id)
    values ('s1', now() + interval '1 hour', 't1', now(), now(), ${id})`
  output(await call('admin.disable', { id, disabled: true }))
  expect(await database.client`select id from admin_session where user_id = ${id}`).toHaveLength(0)
  const list = output<{ items: { id: string; disabled: boolean }[] }>(await call('admin.list', {}))
  expect(list.items.find((a) => a.id === id)).toMatchObject({ disabled: true })
})

test('admin.create never stores the password in the audit log', async () => {
  output(await newAdmin([]))
  const rows = await database.client`select input from audit_log where action = 'admin.create'`
  expect(rows.length).toBeGreaterThan(0)
  expect(JSON.stringify(rows)).not.toContain(PASSWORD)
})

test('admin.list and role.list show roles, 2FA and status', async () => {
  const list = output<{ items: Record<string, unknown>[] }>(await call('admin.list', {}))
  expect(list.items.find((a) => a.id === owner.id)).toMatchObject({
    roles: ['owner'],
    twoFactorEnabled: false,
    disabled: false,
  })
  expect(JSON.stringify(list)).not.toContain('password')
  const roles = output<{ items: { id: string; system: boolean }[] }>(await call('role.list', {}))
  expect(roles.items).toContainEqual({
    id: 'owner',
    name: 'Owner',
    permissions: ['*'],
    system: true,
  })
})
