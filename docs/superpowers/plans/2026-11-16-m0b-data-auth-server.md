# M0b: Data, Auth and Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M0b turns the M0a call path into a usable backend. Modules get typed records with history and merchant-defined fields, settings, background jobs and a privacy class on every field. Admins sign in with mandatory 2FA and roles. Every action is reachable over HTTP, with an OpenAPI document generated from the registry.

**Architecture:** `packages/core` stays database-free. It defines each new contract: resources, attributes, settings, jobs, privacy and services. It also defines the storage each contract needs as a named **service**, and generates resource actions. `packages/db` provides the PostgreSQL implementations of those services. `packages/auth` wraps Better Auth for admin identities. `modules/system` and `modules/access` hold the admin actions for settings, attributes, jobs, roles and admins. `apps/server` is a Hono app that turns HTTP requests into registry calls, and it also runs the job worker.

**Tech Stack:**

- Already in use from M0a: Node 24, TypeScript 6 (strict), Zod 4, Drizzle ORM, postgres-js, PostgreSQL 17, Vitest.
- New in M0b:
  - Hono, with `@hono/node-server`.
  - Better Auth (the two-factor plugin and the Drizzle adapter).
  - `otpauth` (tests only).

**Spec:** `docs/superpowers/specs/2026-11-15-ai-commerce-design.md`. The sections that matter most:

- 3g (privacy)
- 4.2, 4.2a, 4.3 and 4.4 (contracts, overrides, the call path, revisions)
- 5.1 (security), 5.2 (testing) and 5.7 (scale)
- 15 (lessons): Magento 1, 13 and 18; Shopware 4 and 8

Also read `PROGRESS.md`, especially its section "Rules for code written on top of M0a".

M0 is split into three plans. This is the second.

| Plan      | Covers                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| M0a, done | Environment, CI, core registry, events, pipelines, modules, audit                                               |
| M0b, this | Services, privacy classes, resources, revisions, attributes, settings, jobs, auth and roles, server and OpenAPI |
| M0c       | i18n, CLI, design system, installer, the sample-module contract test end to end, the M0 QA gate                 |

**Rulings in this plan** (recorded in Notion 10 when M0b closes):

- **i18n moves to M0c.** It is first used by the installer UI, so building it in M0b would build it for nothing.
- **The admin IP allow-list moves to M1**, together with the admin app. It depends on correct proxy settings, and M1 is where they are first deployed.
- **API tokens stay in M10**, as the roadmap says. M0b actors are guest, admin and system.

## Global Constraints

- Docker only: every command runs as `./dev <command>`. Nothing is installed on the host.
- Node 24, TypeScript `strict`, ES modules, package scope `@aicommerce/*`, MIT.
- One pull request per task, merged without asking once CI is green, never merged red.
- No Claude or Anthropic attribution in commits or pull requests.
- Testing:
  - Unit tests cover logic.
  - Integration tests run against real PostgreSQL, one schema per test file. Anything that touches the database needs one.
- `packages/core` imports no database, HTTP or auth library.
- Every path to data goes through an action (spec 5.1).
- Privacy:
  - A field with no privacy class is `personal`.
  - `secret` can never be sent to a model and has no setting that allows it (spec 3g).
- Lists are paginated by cursor and never load a whole table (spec 5.7).
- App processes hold no state between requests. Rate limits and sessions live in PostgreSQL (spec 5.7).
- Secrets are encrypted at rest (spec 5.1).
- M0a rules still hold:
  - Nested input objects must be `z.strictObject`.
  - Handlers await everything.
  - Events are delivered after commit.
  - Read actions do not write.
- For any API of a library new to M0b (Better Auth, Hono) and for Zod 4 internals: pin the current stable version, read its documentation for that version, and use the names it gives. This plan fixes the behaviour, not the library's option names.

## Review Focus

1. **Two writers on one record.** Two tabs, or the AI and a person, update the same record from the same version. One succeeds; the other gets `conflict` and nothing is overwritten silently. (Task 4: "concurrent updates from one version: exactly one wins")
2. **An admin call without full rights.** It comes over HTTP from a guest, a disabled admin, or an admin who has not set up 2FA. It is refused before the action runs: 401 for a guest, 403 for an admin. (Task 8: "an admin without 2FA has no permissions"; Task 9: "guest gets 401, admin without permission 403")
3. **A cross-site request carrying the admin cookie.** It is rejected before any action runs. (Task 9: "cookie request from another origin is rejected")
4. **A secret setting.** It never appears in any action output, revision, audit row, log line or OpenAPI document, and its ciphertext cannot be read if it is copied to another key. (Task 6)
5. **Escalation and lock-out.** An admin cannot grant a permission they do not hold, and nobody can remove, demote or disable the last owner. (Task 8)

---

### Task 1: Core: services, handler errors, namespaces, hardening

**Files:**

- Create:
  - `packages/core/src/service.ts`
  - `packages/core/src/errors.ts`
- Modify:
  - `packages/core/src/result.ts`
  - `packages/core/src/action.ts`
  - `packages/core/src/actor.ts`
  - `packages/core/src/module.ts`
  - `packages/core/src/app.ts`
  - `packages/core/src/registry.ts`
  - `packages/core/src/index.ts`
- Test:
  - `packages/core/src/service.test.ts`
  - `packages/core/src/errors.test.ts`
  - additions to `packages/core/src/app.test.ts` and `packages/core/src/hardening.test.ts`

**Interfaces:**

- Produces:
  - `ErrorCode` gains `'conflict'`.
  - `class ActionError extends Error { constructor(code: 'invalid_input' | 'not_found' | 'conflict' | 'forbidden', message: string, issues?: CallError['issues']) }`. A handler throws it to fail with that code and message. The transaction rolls back, `onError` is not called, and the audit outcome is the code.
  - `defineService<T>(name: string): ServiceDefinition<T>`
  - `provide<T>(service: ServiceDefinition<T>, module: string, implementation: T): ServiceProvision<T>`
  - `ModuleDefinition` gains:
    - `provides?: ServiceProvision[]`
    - `namespaces?: string[]` (default `[name]`)
  - `AppOptions` gains `services?: ServiceProvision[]`. These are defaults; their `module` is `'app'`.
  - `ActionContext` gains `service<T>(def: ServiceDefinition<T>): T`.
  - `App` gains `service<T>(def): T`. `inspect` takes `'service'` and returns `{ provider: string; replaced: string[] }`.
  - The registry option `service?: <T>(def: ServiceDefinition<T>) => T` is passed through from `createApp`.

- [ ] **Step 1: Write the failing tests.**
  - `service.test.ts`:
    - `'a module replaces a default service'`: `ctx.service(clock)` returns the module's implementation; `inspect('service', 'test.clock')` returns `{ provider: 'fake-clock', replaced: ['app'] }`.
    - `'an unprovided service throws a named error'`: a handler calling it gets `handler_error`, and `onError` receives `Service "test.clock" is not provided`.
    - `'two unrelated modules providing one service fail at startup'`: `createApp` throws `Modules "a" and "b" both provide service "test.clock"; one must depend on the other`.
    - `'the dependent module wins'`: with `b` depending on `a`, `b`'s implementation is used.
  - `errors.test.ts`:
    - `'a handler can fail with conflict'`: the result is `{ ok: false, error: { code: 'conflict', message: 'Changed meanwhile' } }`, `onError` is not called, the audit outcome is `conflict`, and a counting fake transaction saw a throw (it rolled back).
    - `'ActionError issues reach the caller'`: code `invalid_input` with `issues[0].path` equal to `['attributes', 'color']`.
  - `app.test.ts`:
    - `'an action outside the module namespaces is rejected'`: `Module "b" cannot declare action "a.x": namespace "a" is not declared by module "b"`.
    - `'two modules claiming one namespace fail'`: `Namespace "x" is claimed by modules "a" and "b"`.
    - `'a wrap must target a module it depends on'`: `Module "b" wraps "a.act" but does not depend on module "a"`. A transitive dependency is allowed.
  - `hardening.test.ts`:
    - `'shared actors cannot gain permissions'`: `(guestActor.permissions as Set<string>).add('*')` throws `TypeError`, and `can(guestActor, 'x')` stays false.
    - `'a wrap cannot change ctx'`: assigning `ctx.actor` inside a wrap gives `handler_error`.
    - `'a wrap calling next twice fails the call'`: the handler ran once and the result is `handler_error`.
- [ ] **Step 2: Run the tests.** Run `./dev pnpm --filter @aicommerce/core test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `systemActor` and `guestActor` use a frozen read-only set whose `add`, `delete` and `clear` throw `TypeError`.
  - `ctx` is `Object.freeze`d.
  - `next` throws `next() called twice by a wrap of module "<m>"` on a second call.
  - Service resolution order: first the defaults, then module provisions in load order. A conflict between modules that do not depend on each other is a startup error.
- [ ] **Step 4: Run the tests.** Run `./dev pnpm test`. Expected: PASS, including every M0a test.
- [ ] **Step 5: Commit** `feat(core): add services, handler errors and module namespaces`, then open the pull request and merge it when green.

### Task 2: Privacy classes and the AI boundary

**Files:**

- Create: `packages/core/src/privacy.ts`
- Test: `packages/core/src/privacy.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Produces:
  - `type PrivacyClass = 'public' | 'internal' | 'personal' | 'secret'`
  - `classify<S extends z.ZodType>(schema: S, privacy: PrivacyClass): S` registers the class in a Zod registry and returns the same schema.
  - `privacyOf(schema: z.ZodType): PrivacyClass | undefined` returns the schema's own class, looking through `optional`, `nullable`, `default` and `readonly`.
  - `interface ModelPolicy { internalRows: boolean; personalFields: readonly string[] }`. Paths are dotted, with `[]` for array items, for example `items[].name`.
  - `toModel(schema: z.ZodType, value: unknown, policy: ModelPolicy): { value: unknown; classes: PrivacyClass[]; removed: string[] }`. This is the only function that prepares data for a model.

**Rules for `toModel`:**

- It walks objects and arrays in step with the schema.
- A value's class is the nearest class on its path. With none, it is `personal`.
- Under `secret`, everything is `secret`.
- What it keeps:
  - `public` is kept.
  - `internal` is kept only when `internalRows` is true.
  - `personal` is kept only when its path is in `personalFields`.
  - `secret` is never kept.
- Keys the schema does not know are removed.
- Kinds it does not walk, such as unions, records and pipes, are one leaf with the nearest class.
- Removed keys are left out, and their paths are listed in `removed`. Stand-ins come in M1.

- [ ] **Step 1: Write the failing tests.** Each test uses `const s = z.object({ name: classify(z.string(), 'public'), total: classify(z.number(), 'internal'), email: z.string(), password: classify(z.string(), 'secret'), lines: z.array(z.object({ sku: classify(z.string(), 'public'), note: z.string() })) })`.
  - `'unclassified fields are personal and removed'`: `email` and `lines[].note` are in `removed`.
  - `'internal needs internalRows'`
  - `'a personal field can be allowed by path'`: `personalFields: ['email']` keeps `email`.
  - `'secret is removed even when allowed'`: `personalFields: ['password']` with `internalRows: true` still removes `password`.
  - `'a class on an object applies inside it'`: a public object with unclassified children keeps the children.
  - `'nothing under secret can be reclassified'`: a public child of a secret object is still removed.
  - `'unknown keys never pass'`: `{ ...valid, extra: 'x' }` removes `extra`.
  - `'classes lists what was kept'`: with the default policy the result is `['public']`.
- [ ] **Step 2: Run the tests.** Run `./dev pnpm --filter @aicommerce/core test privacy`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** in `privacy.ts`. Reuse the Zod-definition walking approach from `assertNestedStrict` in `registry.ts`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): add privacy classes and the AI boundary`, then open the pull request and merge it.

### Task 3: Database: runtime role, migration checksums, rate limiter, ops fixes

**Files:**

- Create:
  - `scripts/db-roles.mjs`
  - `packages/db/src/roles.ts`
  - `packages/db/src/rate-limit.ts`
  - `packages/db/migrations/core/0002_rate_limit.sql`
- Modify:
  - `packages/db/src/migrate.ts`
  - `packages/db/src/test-db.ts`
  - `packages/db/src/index.ts`
  - `compose.yaml`
  - `.github/workflows/*.yml`
  - `package.json` (script `db:roles`)
  - `.env.example`
- Test:
  - `packages/db/src/roles.integration.test.ts`
  - `packages/db/src/rate-limit.integration.test.ts`
  - additions to `migrate.integration.test.ts`

**Interfaces:**

- Produces:
  - Environment variables:
    - `DATABASE_URL` is the runtime role: `postgres://aicommerce_app:aicommerce_app@db:5432/aicommerce`.
    - `MIGRATION_DATABASE_URL` is the owner role: `postgres://aicommerce:aicommerce@db:5432/aicommerce`.
  - `pnpm db:roles` creates the login role `aicommerce_app` if it is missing. It is idempotent and connects with the owner URL.
  - `runMigrations(database, sources, options?: { appRole?: string; log?: (message: string) => void })`.
    - With `appRole`, it finishes by calling `grantAppRole(database, appRole)`. That grants schema usage, `select, insert, update, delete` on all tables and sequence usage. It then revokes `update, delete, truncate` on the append-only tables `audit_log` and `revision`, skipping any that do not exist yet.
  - `createTestDb(options?: { role?: 'owner' | 'app' })`.
  - `createRateLimiter(database): { hit(key: string, rule: { limit: number; windowSeconds: number }): Promise<{ allowed: boolean; retryAfterSeconds: number }> }`.
    - It uses one upsert per call on `rate_limit(key, window_start, count)`.
    - The same statement deletes that key's older windows.

- [ ] **Step 1: Write the failing tests.**
  - `roles`:
    - `'the app role cannot change or delete audit rows, even without the trigger'`: it fails with `permission denied`.
    - `'the app role cannot alter tables'`
    - `'the app role can insert audit rows'`
  - `migrate`:
    - `'an applied migration that was edited is reported'`: `Migration demo/0001_x.sql was changed after it was applied`.
    - `'a run waiting for the lock says so'`: another connection holds the advisory lock, the run logs `Waiting for another process to finish migrations`, and it completes once the lock is released.
  - `rate-limit`:
    - `'allows up to the limit in a window, then refuses with retryAfterSeconds > 0'`
    - `'separate keys are independent'`
    - `'a new window allows again'`: the test moves `window_start` back with SQL.
- [ ] **Step 2: Run the tests.** Run `./dev pnpm db:roles && ./dev pnpm test:integration`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - The migrations table gains a `checksum` column holding the SHA-256 of the file. Rows without one are backfilled on first run.
  - Lock: try `pg_try_advisory_lock`; if that fails, log and then wait with `pg_advisory_lock`.
  - CI runs `pnpm db:roles` after install.
- [ ] **Step 4: Apply the deferred ops minors** from `PROGRESS.md`:
  - Pin `axllent/mailpit` to a version tag and publish it on `127.0.0.1:8025`.
  - CI: `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
  - Move `pnpm audit` into a separate job, `audit`, that is not required.
  - Pin every action by commit SHA with a version comment. Dependabot keeps them updated.
- [ ] **Step 5: Run the tests.** Run `./dev pnpm test:integration`. Expected: PASS. The `ci` check is green on the pull request.
- [ ] **Step 6: Commit** `feat(db): runtime role, migration checksums and rate limiter`, then merge.

### Task 4: Resources and revisions

**Files:**

- Create:
  - `packages/core/src/resource.ts`
  - `packages/db/src/resources.ts`
  - `packages/db/migrations/core/0003_revision.sql`
  - `modules/sample/migrations/0001_note.sql`
  - `modules/sample/vitest.integration.config.ts`
- Modify:
  - `packages/core/src/app.ts` (generates actions)
  - `packages/core/src/module.ts`
  - `packages/core/src/index.ts`
  - `packages/db/src/index.ts`
  - `modules/sample/src/index.ts`
- Test:
  - `packages/core/src/resource.test.ts`
  - `modules/sample/src/note.integration.test.ts`

**Interfaces:**

- Produces in core:
  - `defineResource({ name, module, label: { singular, plural }, fields, table?, permissions?, attributes? })`
    - `name` matches `/^[a-z][a-z0-9-]*$/`.
    - `fields` is a `z.strictObject`.
    - `table` defaults to the name with `-` replaced by `_`.
    - `permissions` defaults to `{ read: '<name>.read', write: '<name>.write', delete: '<name>.delete' }`. Setting `read: null` makes reads public.
    - `attributes` defaults to false.
  - `ModuleDefinition.resources?: ResourceDefinition[]`. Each resource name becomes a namespace of its module.
  - `ResourceRecord = { id: string; version: number; createdAt: string; updatedAt: string; attributes: Record<string, unknown> } & fields`
  - `Revision = { id: string; resource: string; recordId: string; version: number | null; action: string; actorType: ActorType; actorId: string | null; onBehalfOf: string | null; at: string; before: ResourceRecord | null; after: ResourceRecord | null }`
  - `interface ResourceStore { list; get; create; update; delete; history; revision; restore }`, with the signatures:
    - `list(r, { filter?, attributes?, cursor?, limit })` returns `{ items, nextCursor }`.
    - `get(r, id)` returns `ResourceRecord | null`.
    - `create(r, values, attributes, meta)` returns a record.
    - `update(r, id, expectedVersion, values, attributes | undefined, meta)` returns a record and throws `ActionError` `not_found` or `conflict`.
    - `delete(r, id, expectedVersion, meta)`
    - `history(r, id, cursor, limit)`
    - `revision(r, revisionId)`
    - `restore(r, revision, meta)`
    - `meta` is `{ action: string; actor: Actor }`.
  - `resourceStore = defineService<ResourceStore>('core.resource-store')`

  Generated actions for resource `<n>`:

  | Action        | Input                                       | Output                              | Risk        | Permission |
  | ------------- | ------------------------------------------- | ----------------------------------- | ----------- | ---------- |
  | `<n>.list`    | `{ filter?, attributes?, cursor?, limit? }` | `{ items, nextCursor }`             | read        | read       |
  | `<n>.get`     | `{ id: uuid }`                              | record                              | read        | read       |
  | `<n>.create`  | `{ values, attributes? }`                   | record                              | write       | write      |
  | `<n>.update`  | `{ id, version, values, attributes? }`      | record                              | write       | write      |
  | `<n>.delete`  | `{ id, version }`                           | `{}`                                | destructive | delete     |
  | `<n>.history` | `{ id, cursor?, limit? }`                   | `{ items: Revision[], nextCursor }` | read        | read       |
  | `<n>.restore` | `{ revisionId }`                            | record                              | write       | write      |

  Details:
  - `filter` is a strict object of the optional scalar fields (string, number, boolean, enum).
  - `limit` is 1 to 200, default 50.
  - `values` in `<n>.update` is the fields made partial (and strict).
  - `defineResource` throws for:
    - a `secret` field: `Resource "note" field "token" is secret; store secrets as settings`;
    - a field named `id`, `version`, `createdAt`, `updatedAt` or `attributes`.
  - In record output, system fields are `public`, fields keep their class, and `attributes` is `personal`.

- Produces in db: `createPgResourceStore(database)`.
  - Columns are the snake_case field names, plus `id uuid`, `version int`, `created_at`, `updated_at` and `attributes jsonb`.
  - Identifiers are checked against `/^[a-z_][a-z0-9_]*$/`.
  - All queries run on `database.current()`, so they join the call's transaction. Each write inserts one revision in the same transaction.
  - The cursor is base64url JSON of `[createdAt, id]`, ordered by `created_at, id`. A bad cursor raises `ActionError('invalid_input', 'Invalid cursor')`.
  - `update` is `... where id = $1 and version = $2 returning *`. With 0 rows, it raises `not_found` if the record is gone, otherwise `conflict` with the message `Record changed since version N; reload and try again`.
  - `restore` writes `revision.after ?? revision.before` as a new version, recreating the record with the same id if it was deleted. The snapshot is first checked against the current fields; if it fails, the error is `invalid_input` `This revision no longer matches the resource's fields`.
  - `revision` is append-only, with triggers like `audit_log`.
- The sample module gains a resource:
  - `note`, with fields `title` (public, 1 to 200 characters), `body` (internal, up to 10,000 characters, optional) and `pinned` (public boolean, default false).
  - `attributes: true`.
  - A migration with a GIN index on `attributes`.
  - `sampleMigrations: MigrationSource`.

- [ ] **Step 1: Write the failing tests.**
  - Unit, `resource.test.ts`:
    - generated names, risks and permissions match the table;
    - a secret field throws;
    - a system field name throws;
    - `read: null` makes `note.list` and `note.get` public.
  - Integration, `note.integration.test.ts`. It uses `createApp` with `createPgResourceStore` and `createDbAuditSink`, and runs `runMigrations([coreMigrations, sampleMigrations])`.
    - `'create then get returns the same record at version 1'`
    - `'create writes a revision with before null and an audit row'`
    - `'list pages by cursor without gaps or repeats'`: 5 records, limit 2, 3 pages.
    - `'list filters by field'`: `pinned: true`.
    - `'update with a stale version is a conflict and changes nothing'`: no new revision either.
    - `'concurrent updates from one version: exactly one wins'`: `Promise.all` of two updates gives one `ok` and one `conflict`.
    - `'delete needs confirmation from an admin, then the record is gone'`: `confirmation_required`, then `ok`, then `get` returns `not_found`.
    - `'history is newest first, and restore brings a deleted record back with its id'`
    - `'a guest cannot create; bad input is invalid_input'`
    - `'revision rows cannot be updated or deleted'`
- [ ] **Step 2: Run the tests.** Run `./dev pnpm test && ./dev pnpm test:integration`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** core `resource.ts`, action generation in `createApp`, and the db store. Then update the sample module.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add resources with revisions and the sample note resource`, then merge.

### Task 5: Attributes

**Files:**

- Create:
  - `packages/core/src/attributes.ts`
  - `packages/db/src/attributes.ts`
  - `packages/db/migrations/core/0004_attribute.sql`
  - the `modules/system` package (`package.json`, `src/index.ts`, `src/attributes.ts`, configs)
- Modify:
  - `packages/core/src/resource.ts` (generated create, update and list validate attributes)
  - `packages/core/src/app.ts`
  - `pnpm-workspace.yaml` (already covers `modules/*`)
- Test:
  - `packages/core/src/attributes.test.ts`
  - `modules/system/src/attributes.integration.test.ts`

**Interfaces:**

- Produces:
  - `defineAttribute({ resource, code, label, type, options?, required?, privacy? })`
    - `code` matches `/^[a-z][a-z0-9_]{0,63}$/`.
    - `type` is one of `'text' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect'`.
    - `options` is for the select types: 1 to 500 unique strings.
    - `required` defaults to false.
    - `privacy` defaults to `'personal'`; `'secret'` is not allowed.
  - `ModuleDefinition.attributes?` takes those. They are marked `source: 'module'` and cannot be deleted by a merchant.
  - Attribute value schemas by type:
    - `text`: `z.string().max(10000)`
    - `number`: a finite `z.number()`
    - `boolean`
    - `date`: `z.iso.date()`
    - `select`: `z.enum(options)`
    - `multiselect`: a unique array of `z.enum(options)`
  - `attributeStore = defineService<AttributeStore>('core.attribute-store')`, where `AttributeStore` is `{ list(resource): Promise<AttributeDefinition[]>; create(def): Promise<void>; delete(resource, code): Promise<void> }`. It holds merchant-created definitions; `createPgAttributeStore(database)` uses the table `attribute`.
  - `appInfo = defineService<AppInfo>('core.app-info')`, provided by `createApp` itself: `{ resources(): ResourceDefinition[]; permissions(): string[]; settings(): SettingDefinition[] }`.
    - `settings()` returns `[]` until Task 6.
    - `permissions()` returns the sorted, unique permissions of every enabled action, plus the per-setting permissions.

  Behaviour of resource actions:
  - `create`: required attributes must be present.
  - `update`: attributes are patched. A given key replaces its value; `null` removes a non-required attribute.
  - An unknown code or a bad value is `invalid_input`, with issue path `['attributes', code]`.
  - `list`: an `attributes` filter becomes `attributes @> $1`. The filter is validated the same way.
  - Output leaves out stored values whose attribute no longer exists or no longer validates.
  - Deleting an attribute keeps the stored values. Recreating the attribute with the same code and type shows them again.
  - `shortcut:` definitions are read on every call; add a cache with invalidation once profiling shows the need (M1).

  `modules/system` claims the namespaces `attribute`, `setting` and `job`, and has these attribute actions:

  | Action             | Input                | Risk        | Permission         |
  | ------------------ | -------------------- | ----------- | ------------------ |
  | `attribute.list`   | `{ resource }`       | read        | `attribute.read`   |
  | `attribute.create` | the definition       | write       | `attribute.manage` |
  | `attribute.delete` | `{ resource, code }` | destructive | `attribute.manage` |
  - On create, an unknown resource or one without attributes is `invalid_input`, and a duplicate code is `conflict`.
  - On delete, a module attribute gives `forbidden`: `Attribute "x" is defined by module "m" and cannot be deleted`.

- [ ] **Step 1: Write the failing tests.**
  - Unit: the schema built for each type accepts and rejects the right values.
  - Integration, on `note`:
    - `'a select attribute accepts its options and rejects others with a path'`
    - `'an unknown attribute code is invalid_input'`
    - `'a required attribute must be given on create'`
    - `'update patches attributes and null removes one'`
    - `'list filters by attribute'`
    - `'a module attribute cannot be deleted'`
    - `'deleting an attribute hides its values; recreating shows them'`
    - `'a guest cannot create attributes'`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add merchant and module attributes`, then merge.

### Task 6: Settings, with secrets encrypted at rest

**Files:**

- Create:
  - `packages/core/src/settings.ts`
  - `packages/db/src/settings.ts`
  - `packages/db/src/crypto.ts`
  - `packages/db/migrations/core/0005_setting.sql`
  - `modules/system/src/settings.ts`
- Test:
  - `packages/core/src/settings.test.ts`
  - `packages/db/src/crypto.test.ts`
  - `modules/system/src/settings.integration.test.ts`

**Interfaces:**

- Produces:
  - `defineSetting({ key, module, label, description?, schema, default?, privacy, scope: 'global' | 'channel', permission? })`
    - `key` matches the action-name pattern, and its first segment must be a namespace of the module.
    - A `secret` setting must have no default.
    - `permission` defaults to `'setting.manage'`.
  - `ModuleDefinition.settings?`
  - `settings = defineService<SettingsReader>('core.settings')`, with `SettingsReader = { get<S>(def: SettingDefinition<S>, options?: { channel?: string }): Promise<z.infer<S> | undefined> }`.
    - Precedence: the channel value, then the global value, then the default.
    - A stored value that no longer validates returns the default and is reported once through `onError`.
  - `createPgSettings(database, { secretKey: Buffer, definitions: () => SettingDefinition[] })` provides `settings`, and the store used by the system actions.
  - Table `setting(key, channel, value jsonb, encrypted text, version, updated_at)`, unique on `(key, coalesce(channel, ''))`.
  - `encryptSecret(plaintext: string, key: Buffer, aad: string): string` and `decryptSecret(token, key, aad): string`.
    - AES-256-GCM with a random 12-byte IV.
    - Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
    - The AAD is the setting key plus the channel.
  - `AICOMMERCE_SECRET_KEY` must decode from base64 to 32 bytes. Otherwise startup fails with `AICOMMERCE_SECRET_KEY must be 32 bytes, base64 encoded`.
  - Setting writes create revisions:
    - resource `'setting'`;
    - `recordId` is the key, plus `@channel` when there is one;
    - secret values appear as `'[secret]'`.

  Actions in `modules/system`:

  | Action            | Input                                | Output                                                                  | Risk  | Permission       |
  | ----------------- | ------------------------------------ | ----------------------------------------------------------------------- | ----- | ---------------- |
  | `setting.list`    | `{ module? }`                        | `{ items: { key, label, scope, privacy, value?, isSet, isDefault }[] }` | read  | `setting.read`   |
  | `setting.set`     | `{ key, value, channel? }`           |                                                                         | write | `setting.manage` |
  | `setting.reset`   | `{ key, channel? }`                  |                                                                         | write | `setting.manage` |
  | `setting.history` | `{ key, channel?, cursor?, limit? }` |                                                                         | read  | `setting.read`   |
  - `setting.list` never includes the `value` of a secret setting.
  - `setting.set`:
    - also checks the setting's own `permission` and gives `forbidden` without it;
    - validates the value and gives `invalid_input` at `['value']`;
    - gives `not_found` for an unknown key;
    - declares `redact: ['value']`, so no setting value ever reaches the audit log. Revisions keep non-secret values.

- [ ] **Step 1: Write the failing tests.**
  - Unit:
    - precedence (channel, then global, then default) with an in-memory store;
    - `crypto`: round trip; a different AAD fails; a tampered tag fails.
  - Integration:
    - `'a secret is stored encrypted'`: the raw row has no plaintext, and `value` is null.
    - `'a secret is never returned by setting.list or setting.history'`
    - `'a ciphertext copied to another key cannot be read'`: the read returns `undefined` and the failure is reported.
    - `'an invalid value is invalid_input at value'`
    - `'an unknown key is not_found'`
    - `'a setting with its own permission needs it'`
    - `'the audit row never contains the value'`
    - `'history shows who changed what, newest first'`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** The sample module gains `sample.greeting-word` (public, global, default `'Hello'`), and `sample.greet` reads it through the `settings` service.
- [ ] **Step 4: Run the tests.** Expected: PASS, including the sample tests, which still return `Hello, Ada`.
- [ ] **Step 5: Commit** `feat: add settings with encrypted secrets`, then merge.

### Task 7: Background jobs and the worker

**Files:**

- Create:
  - `packages/core/src/jobs.ts`
  - `packages/db/src/jobs.ts`
  - `packages/db/migrations/core/0006_job.sql`
  - `modules/system/src/jobs.ts`
- Test:
  - `packages/core/src/jobs.test.ts`
  - `packages/db/src/jobs.integration.test.ts`
  - `modules/system/src/jobs.integration.test.ts`

**Interfaces:**

- Produces:
  - `defineJob({ name, module, description, payload, maxAttempts?, timeoutSeconds?, handler })`
    - `name` follows the action-name and namespace rules.
    - `payload` is a `z.strictObject`.
    - `maxAttempts` is 1 to 25, default 5.
    - `timeoutSeconds` defaults to 300.
    - `handler` is `(payload, ctx: JobContext) => Promise<void>`.
  - `JobContext = { jobId: string; attempt: number; service: ActionContext['service']; call(name: string, input: unknown): Promise<Result<unknown>> }`. `call` runs as `systemActor`.
  - `ModuleDefinition.jobs?`; `App.jobs(): JobDefinition[]`.
  - `jobs = defineService<JobQueue>('core.jobs')`, with `JobQueue = { enqueue(job, payload, options?: { runAt?: Date; key?: string }): Promise<{ id: string; duplicate: boolean }> }`.
    - The payload is validated at enqueue; a bad payload throws.
    - Enqueue goes through `database.current()`, so a job enqueued in a call that rolls back never exists.
  - `createPgJobQueue(database)`.
  - `createWorker({ database, app, concurrency?: number /* 4 */, pollIntervalMs?: number /* 1000 */, log? })` returns `{ runOnce(): Promise<number>; start(): void; stop(): Promise<void> }`.
  - Table `job(id uuid, name, payload jsonb, key, status, attempts, max_attempts, run_at, locked_at, locked_by, last_error, created_at, updated_at, done_at)`.
    - `status` is one of `pending`, `running`, `done` or `failed`.
    - Unique index on `(name, key)` while the status is `pending` or `running`.
  - What `runOnce` does:
    - It first returns `running` jobs older than their timeout to `pending`.
    - It claims jobs with `for update skip locked`, only names the app knows. A disabled module's jobs wait.
    - A job runs outside any transaction; it writes through `ctx.call`.
    - On success the job is `done`.
    - On failure the job goes back to `pending`, with `run_at = now + min(10 s × 2^(attempts − 1), 1 h)`, or to `failed` once `attempts = maxAttempts`.
    - `last_error` holds the message, up to 2,000 characters.

  Actions in `modules/system`:

  | Action      | Input                          | Risk  | Permission   |
  | ----------- | ------------------------------ | ----- | ------------ |
  | `job.list`  | `{ status?, cursor?, limit? }` | read  | `job.read`   |
  | `job.retry` | `{ id }`                       | write | `job.manage` |

  `job.retry` moves a failed job back to pending with attempts reset to 0. A job that has not failed gives `conflict`.

- [ ] **Step 1: Write the failing tests.**
  - `'a job enqueued in a rolled-back call never exists'`
  - `'a job runs once and is done'`
  - `'a failing job is retried with backoff, then succeeds'`: the test moves `run_at` back with SQL.
  - `'a job failing every attempt ends failed with its error'`
  - `'two workers never run the same job'`: 10 jobs, two workers calling `runOnce` at the same time; every job runs exactly once.
  - `'a job stuck running past its timeout is picked up again'`
  - `'a duplicate key while pending is reported, not enqueued'`
  - `'a job of a disabled module waits'`
  - `'job.retry moves a failed job back; a pending one is a conflict'`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add background jobs and the worker`, then merge.

### Task 8: Admin authentication, 2FA and roles

**Files:**

- Create:
  - the `packages/auth` package (`src/index.ts`, `src/schema.ts`, `migrations/0001_admin_auth.sql`, configs)
  - the `modules/access` package (`src/index.ts`, `src/roles.ts`, `src/admins.ts`)
- Test:
  - `packages/auth/src/auth.integration.test.ts`
  - `modules/access/src/access.integration.test.ts`

**Interfaces:**

- Produces:
  - `createAdminAuth({ database, baseURL, secret, trustedOrigins, production })` returns `AdminAuth = { handler(request: Request): Promise<Response>; resolveActor(headers: Headers): Promise<Actor | null>; identity: Identity }`.
  - Better Auth configuration:
    - email and password, with self sign-up disabled;
    - passwords of 12 to 128 characters;
    - sessions that expire after 8 hours, refreshed after 1 hour of use;
    - cookie prefix `aicommerce-admin`, `httpOnly`, `sameSite: 'strict'`, and `secure` in production;
    - rate limiting stored in the database, with sign-in limited to 5 attempts per 60 seconds;
    - the two-factor plugin with TOTP, issuer `AI Commerce`;
    - tables named `admin_user`, `admin_session`, `admin_account`, `admin_verification`, `admin_two_factor` and `admin_rate_limit`, which leaves `customer_*` free for M2;
    - an extra user field, `disabled` (boolean, default false). A disabled user cannot create a session.
  - The migration holds:
    - the schema Better Auth generates for the pinned version, with the table names above;
    - `admin_role(id text pk, name text, permissions jsonb, system boolean, created_at)`;
    - `admin_user_role(user_id, role_id, pk)`;
    - the seeded owner role: `('owner', 'Owner', '["*"]', true)`.
  - `resolveActor`:
    - no valid session, or a disabled user: `null`, which means guest;
    - a session whose user has not turned on 2FA: an `admin` actor with **no** permissions;
    - otherwise the union of the user's role permissions.
  - `identity = defineService<Identity>('core.identity')`, with `Identity = { createAdmin(input: { email: string; name: string; password: string }): Promise<{ id: string }>; setDisabled(id: string, disabled: boolean): Promise<void>; revokeSessions(id: string): Promise<void> }`.
  - `databaseService = defineService<Database>('db.database')`, exported from `@aicommerce/db` so modules can run typed queries on `current()`.

  `modules/access` claims the namespaces `role` and `admin`:

  | Action            | Input                              | Risk        | Permission     |
  | ----------------- | ---------------------------------- | ----------- | -------------- |
  | `role.list`       |                                    | read        | `role.read`    |
  | `role.create`     | `{ name, permissions }`            | write       | `role.manage`  |
  | `role.update`     | `{ id, name?, permissions? }`      | write       | `role.manage`  |
  | `role.delete`     | `{ id }`                           | destructive | `role.manage`  |
  | `admin.list`      |                                    | read        | `admin.read`   |
  | `admin.create`    | `{ email, name, password, roles }` | write       | `admin.manage` |
  | `admin.set-roles` | `{ id, roles }`                    | write       | `admin.manage` |
  | `admin.disable`   | `{ id, disabled }`                 | destructive | `admin.manage` |

  `admin.list` returns `{ id, email, name, roles, twoFactorEnabled, disabled }`.

  Rules:
  - A permission that is not in `appInfo.permissions()` and is not `*` is `invalid_input`.
  - Granting, directly or through a role, any permission the caller lacks is `forbidden`: `You cannot grant permissions you do not have`. Only a caller holding `*` can grant `*` or the owner role.
  - A system role cannot be changed or deleted: `forbidden`.
  - A role still in use cannot be deleted: `conflict`.
  - At least one active owner must remain, so removing the owner role from, or disabling, the last owner is `conflict`.
  - Disabling yourself is `conflict`.
  - Disabling an admin revokes their sessions.

- [ ] **Step 1: Write the failing tests.** They drive Better Auth through `auth.handler(new Request(...))` and compute TOTP codes with `otpauth`.
  - `auth`:
    - `'sign-in with the right password creates a session'`
    - `'the sixth failed sign-in within a minute is refused with 429'`
    - `'an admin without 2FA has no permissions'`
    - `'after enabling 2FA, sign-in needs the TOTP code and the actor has its role permissions'`
    - `'a disabled admin cannot sign in and their session stops working'`
    - `'an expired session resolves to guest'`: the test moves `expires_at` back with SQL.
    - `'self sign-up is disabled'`
  - `access`:
    - `'an admin cannot grant a permission they lack'`
    - `'only an owner can grant the owner role'`
    - `'unknown permissions are invalid_input'`
    - `'the owner role cannot be changed or deleted'`
    - `'a role in use cannot be deleted'`
    - `'the last owner cannot be demoted or disabled'`
    - `'disabling an admin ends their sessions'`
    - `'admin.create never stores the password in the audit log'`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Generate the Better Auth schema with its CLI for the pinned version, then commit the SQL with the renamed tables.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add admin authentication with mandatory 2FA and roles`, then merge.

### Task 9: The server, OpenAPI and the public-action review

**Files:**

- Create the `apps/server` package:
  - `src/server.ts`
  - `src/openapi.ts`
  - `src/env.ts`
  - `src/main.ts`
  - `security/public-actions.json`
  - configs
- Modify:
  - `pnpm-workspace.yaml` (add `apps/*`)
  - `compose.yaml` (service `server` on `127.0.0.1:3000`)
  - `.env.example`
- Test:
  - `apps/server/src/server.integration.test.ts`
  - `apps/server/src/openapi.test.ts`
  - `apps/server/src/public-actions.test.ts`

**Interfaces:**

- Consumes: `App` and its services from Tasks 1 to 8, `AdminAuth`, `createRateLimiter`, `createWorker`.
- Produces: `createServer({ app, auth, database, rateLimiter, publicUrl, production, trustedProxies?, log? }): Hono`. Its routes:

  | Route                     | Behaviour                                                                                          |
  | ------------------------- | -------------------------------------------------------------------------------------------------- |
  | `GET /healthz`            | 200 `{ ok: true }`                                                                                 |
  | `GET /readyz`             | 200 after `select 1`, otherwise 503                                                                |
  | `/api/auth/*`             | `auth.handler`                                                                                     |
  | `GET /api/me`             | `{ actor: { type, id }, permissions: string[], twoFactorRequired: boolean }`                       |
  | `POST /api/actions/:name` | Runs the action. Body: `z.strictObject({ input: z.unknown(), confirmed: z.boolean().optional() })` |
  | `GET /api/openapi.json`   | The OpenAPI document                                                                               |

  Rules for `POST /api/actions/:name`:
  - A content type other than JSON gets 415, and a body over 1 MiB gets 413.
  - **CSRF:** when the request has a valid admin session, its `Origin` must be `publicUrl`'s origin or one of the trusted origins. Otherwise it gets 403 with `Cross-site request rejected`, and the action never runs.
  - Status codes:
    - `ok`: 200
    - `invalid_input`: 400
    - `forbidden`: 401 for a guest, 403 for an admin
    - `not_found`: 404, also for an unknown action
    - `conflict`: 409
    - `confirmation_required`: 428
    - over a rate limit: 429, with `Retry-After`
    - `handler_error`: 500
  - The body is the registry `Result`.
  - Rate limits: guests 120 per 60 seconds per client IP; admins 600 per 60 seconds per admin id. The client IP comes from the socket. `X-Forwarded-For` is only used for the configured number of trusted proxy hops (default 0).

  Every response sets these headers:
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Cross-Origin-Resource-Policy: same-origin`
  - `Cache-Control: no-store` on `/api`
  - HSTS (`max-age=31536000; includeSubDomains`) in production
  - `X-Request-Id`

  Logging: one JSON line per request, `{ at, requestId, method, path, action, status, ms, actorType }`. Bodies and headers are never logged.

  The OpenAPI document:
  - OpenAPI 3.1, title `AI Commerce`, version `VERSION`.
  - One path per enabled action, `POST /api/actions/<name>`.
  - The request body is `{ input, confirmed }`, with `input` from `z.toJSONSchema(action.input, { io: 'input' })`.
  - Responses:
    - 200 holds the output schema.
    - 400, 401, 403, 404, 409, 428, 429 and 500 share one `Error` schema.
  - Each path carries `summary` (the action description), `tags` (the namespace), `x-aicommerce-permission` and `x-aicommerce-risk`.

  `main.ts`:
  - It validates the environment with Zod, and the error names every missing or invalid variable. The variables are:
    - `DATABASE_URL`, `MIGRATION_DATABASE_URL`
    - `AICOMMERCE_SECRET_KEY`, `AICOMMERCE_AUTH_SECRET` (at least 32 characters)
    - `AICOMMERCE_PUBLIC_URL`, `PORT` (default 3000)
    - `AICOMMERCE_ROLE`: `all`, `web` or `worker`, default `all`
    - `AICOMMERCE_MODULES`, default `system,access,sample`
    - `AICOMMERCE_TRUSTED_PROXIES`, default 0
  - It runs migrations with the owner URL and `appRole`.
  - It builds the app with every service from Tasks 3 to 8.
  - It starts the web server, the worker, or both.
  - On `SIGTERM` it stops accepting requests, waits for requests in flight, stops the worker and closes the database.

  The public-action review: `security/public-actions.json` lists every action with `permission: null` across all first-party modules (`["sample.greet", "sample.note-list"…]`, whatever exists at that point). A test fails when the real list differs, so a new public action cannot ship unreviewed (Magento lesson 1).

- [ ] **Step 1: Write the failing tests.** They use `server.request(...)` with a test database and real Better Auth.
  - `'sample.greet returns 200 for a guest'`
  - `'guest gets 401, admin without permission 403'`
  - `'bad input is 400 with issues'`
  - `'an unknown action is 404'`
  - `'cookie request from another origin is rejected'`: 403, and no audit row is written.
  - `'a non-JSON body is 415, an oversized body 413'`
  - `'the 121st guest call in a minute is 429 with Retry-After'`
  - `'a destructive action needs confirmed: true (428 without)'`
  - `'every response carries the security headers'`
  - `'/readyz is 503 when the database is down'`: it uses a handle that has been closed.
  - `'the log line never contains the request body'`: a password sent in the input does not appear in any logged line.
  - `openapi`:
    - `'every enabled action has a path with permission and risk'`
    - `'the document contains no secret setting value or default'`
    - `'the input schema rejects unknown keys (additionalProperties false)'`
  - `public-actions`:
    - `'the public actions are exactly the reviewed list'`
    - `'each public action answers bad input with 400, never 500'`: it sends `42`, `{ "__proto__": {} }` and a 2 MB string.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Run `./dev docker compose up server`, then check by hand that `curl -s localhost:3000/healthz` returns `{"ok":true}`.
- [ ] **Step 4: Run the tests.** Run `./dev pnpm test && ./dev pnpm test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): add the HTTP API, OpenAPI and public-action review`, then merge.

### Task 10: Guides, threat model, decision records

**Files:**

- Create:
  - `docs/guides/` with one page each for actions, modules and wraps, events, pipelines, services, privacy classes, resources and revisions, attributes, settings, jobs, admin auth and roles, and the HTTP API
  - `docs/security/threat-model-m0b.md`
  - `docs/decisions/log.md`
- Modify:
  - `README.md` (links)
  - `PROGRESS.md`

- [ ] **Step 1: Write one guide per contract** (spec 5.4).
  - Each guide explains the contract in plain words.
  - Its example is the matching code in `modules/sample`, cited by file. The example is therefore run by the sample module's tests in CI.
  - Each guide states the rules that bite, taken from the interfaces above.
- [ ] **Step 2: Write the threat model.** It covers:
  - assets: admin accounts, secrets, personal data and the audit trail;
  - entry points: the action endpoint, `/api/auth`, the worker and migrations;
  - each threat with its mitigation and the test that proves it;
  - residual risks, such as the IP allow-list in M1, API tokens in M10 and key rotation for `AICOMMERCE_SECRET_KEY`.
- [ ] **Step 3: Write `docs/decisions/log.md`.**
  - It mirrors Notion 10 · Decisions log: decisions 1 to 50 plus this plan's rulings.
  - Each entry has its number, date, who decided and the decision, in one or two lines.
  - From now on, every decision goes to both places.
- [ ] **Step 4: Check formatting.** Run `./dev pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `docs: guides, M0b threat model and decision records`, then merge.

**M0b done when:**

- Over HTTP, a guest gets 200 from `sample.greet`, 401 from `note.create`, and 400 for bad input.
- An owner signs in with 2FA and creates a role and an admin.
- That admin creates, edits, conflicts on, deletes and restores a note, and adds a merchant attribute to it.
- A secret setting is stored encrypted.
- A job runs in the worker.
- Every one of those calls has an audit row.
- `/api/openapi.json` lists every enabled action.
- Unit and integration tests are green in CI.
- End-to-end tests start in M0c, together with the first UI.
