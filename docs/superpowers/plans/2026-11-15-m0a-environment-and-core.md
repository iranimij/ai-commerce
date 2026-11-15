# M0a: Environment and Core Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Docker-only TypeScript monorepo with full CI and GitHub setup, and a `core` package where a module declares actions, events and pipeline steps and every call runs through one validated, authorised, audited path.

**Architecture:** pnpm workspaces with Turborepo. `packages/core` holds the registry and is framework-free. `packages/db` holds the PostgreSQL connection and migrations. Everything runs through `docker compose`; the host needs only Docker, git and gh.

**Tech Stack:** Node 24, TypeScript (strict), pnpm, Turborepo, Zod, Drizzle ORM, PostgreSQL 17, Vitest, ESLint, Prettier, Changesets, commitlint, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-15-ai-commerce-design.md` (sections 2, 3 decisions 16 to 19, 4.2, 4.3, 5.1, 5.2).

M0 is split into three plans. This is the first.

| Plan       | Covers                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| M0a (this) | Environment, tooling, CI, GitHub setup, core registry, events, pipelines, modules, audit                      |
| M0b        | Resources, attributes, settings, revisions, auth and roles, server with generated endpoints and OpenAPI, i18n |
| M0c        | CLI, design system, installer, sample-module contract test end to end, M0 QA gate                             |

## Global Constraints

- Docker only: every command runs as `./dev <command>`, which wraps `docker compose run --rm app`. Nothing is installed on the host.
- Node 24, TypeScript `strict: true`, ES modules only.
- Package scope `@aicommerce/*`. Licence MIT.
- One pull request per task. Merge without asking once CI is green. Never merge a red one.
- Conventional commit messages. No Claude or Anthropic attribution in commits or pull requests.
- Unit tests for logic, integration tests against real PostgreSQL for anything that touches the database.
- App processes hold no state between calls (spec 5.7).
- English everywhere.

## Review Focus

1. A handler that throws: the caller gets `handler_error` with a generic message, the transaction is rolled back, and the audit row is still written. (Task 3, Task 6)
2. Input with extra unknown keys, as an AI model may send: rejected as `invalid_input`, never silently dropped. (Task 3)
3. A module that depends on a missing or disabled module, or a dependency cycle: startup fails with an error naming the modules; it never hangs. (Task 5)
4. An event subscriber that throws: the action's result stands and the other subscribers still run. (Task 4)
5. A secret in action input (password, API key): never stored in the audit log. (Task 6)

---

### Task 1: Docker environment and monorepo skeleton

**Files:**

- Create: `compose.yaml`, `docker/Dockerfile.dev`, `dev`, `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.nvmrc`, `.env.example`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/vitest.config.ts`
- Test: `packages/core/src/index.test.ts`

**Interfaces:**

- Produces: `./dev <command>` runs any command in the `app` container. Root scripts: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm build`, each delegating to Turborepo. Services: `app` (node:24, workdir `/app`, repo mounted, `node_modules` in a named volume), `db` (postgres:17, database `aicommerce`, user `aicommerce`, password `aicommerce`, healthcheck), `mail` (mailpit). `DATABASE_URL=postgres://aicommerce:aicommerce@db:5432/aicommerce` is set in the `app` service.

- [ ] **Step 1:** Write `compose.yaml`, `docker/Dockerfile.dev` (node:24, corepack-enabled pnpm, non-root user) and the executable `dev` script (`docker compose run --rm app "$@"`).
- [ ] **Step 2:** Write root tooling files. ESLint uses `typescript-eslint` strict type-checked rules. Prettier: 100 columns, single quotes, no semicolons.
- [ ] **Step 3:** Write the failing test `packages/core/src/index.test.ts`:

```ts
import { expect, test } from 'vitest'
import { VERSION } from './index'

test('core exposes its version', () => {
  expect(VERSION).toBe('0.0.0')
})
```

- [ ] **Step 4:** Run `./dev pnpm install && ./dev pnpm test`. Expected: FAIL, `VERSION` is not exported.
- [ ] **Step 5:** Export `VERSION = '0.0.0'` from `packages/core/src/index.ts`.
- [ ] **Step 6:** Run `./dev pnpm lint && ./dev pnpm format:check && ./dev pnpm typecheck && ./dev pnpm test && ./dev pnpm build`. Expected: all pass.
- [ ] **Step 7:** Commit `chore: add Docker environment and monorepo skeleton`, open the pull request, merge.

### Task 2: CI and GitHub repository setup

**Files:**

- Create: `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/workflows/release.yml`, `.github/dependabot.yml`, `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`, `.github/ISSUE_TEMPLATE/config.yml`, `.github/CODEOWNERS`
- Create: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `commitlint.config.js`, `.changeset/config.json`
- Modify: `package.json` (add `commitlint`, `changeset` scripts and dev dependencies), `README.md` (add CI badge and a "Development" section)

**Interfaces:**

- Produces: required status check named `ci` (one job that runs lint, format check, typecheck, unit tests, integration tests with a `postgres:17` service, build, `pnpm audit --audit-level high`, and commitlint on the pull request title). CI runs on the GitHub runner with Node 24 directly; Docker-only is the rule for the developer machine.

- [ ] **Step 1:** Write `ci.yml` with the single `ci` job on `pull_request` and `push` to `main`, with pnpm caching and `DATABASE_URL` pointing at the service container.
- [ ] **Step 2:** Write `codeql.yml` (javascript-typescript, weekly and on pull request), `dependabot.yml` (npm and github-actions, weekly, grouped minor and patch), and `release.yml` (Changesets action on push to `main`; publishing is skipped while `NPM_TOKEN` is absent).
- [ ] **Step 3:** Write the community files. `SECURITY.md`: report privately through GitHub security advisories, never in a public issue. `CODE_OF_CONDUCT.md`: Contributor Covenant 2.1. `CONTRIBUTING.md`: `./dev` workflow, test levels, conventional commits, one pull request per change.
- [ ] **Step 4:** Open the pull request. Expected: the `ci` check and CodeQL run and pass.
- [ ] **Step 5:** Merge, then protect `main` and enable security features:

```bash
gh api -X PUT repos/iranimij/ai-commerce/branches/main/protection --input - <<'JSON'
{"required_status_checks":{"strict":true,"contexts":["ci"]},
 "enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null,
 "required_linear_history":true,"allow_force_pushes":false,"allow_deletions":false}
JSON
gh api -X PATCH repos/iranimij/ai-commerce -f delete_branch_on_merge=true -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false
gh api -X PUT repos/iranimij/ai-commerce/vulnerability-alerts
gh api -X PATCH repos/iranimij/ai-commerce --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON
```

- [ ] **Step 6:** Verify: `gh api repos/iranimij/ai-commerce/branches/main/protection --jq '.required_status_checks.contexts'` prints `["ci"]`.

### Task 3: Actions and the call path

**Files:**

- Create: `packages/core/src/actor.ts`, `packages/core/src/action.ts`, `packages/core/src/registry.ts`, `packages/core/src/result.ts`
- Modify: `packages/core/src/index.ts` (re-export)
- Test: `packages/core/src/registry.test.ts`

**Interfaces:**

- Produces:

```ts
// actor.ts
export type ActorType = 'guest' | 'customer' | 'admin' | 'token' | 'system'
export interface Actor {
  type: ActorType
  id: string | null
  permissions: ReadonlySet<string> // '*' grants everything
  onBehalfOf?: string // admin id when the AI acts for an admin
}
export const systemActor: Actor
export const guestActor: Actor
export function can(actor: Actor, permission: string | null): boolean // null = public

// action.ts
export type Risk = 'read' | 'write' | 'destructive'
export interface ActionContext {
  actor: Actor
  actionName: string
}
export interface ActionDefinition<I extends z.ZodObject, O extends z.ZodType> {
  name: string // 'module.verb', lower case, dot separated
  description: string
  input: I
  output: O
  permission: string | null
  risk: Risk
  redact?: (keyof z.infer<I>)[] // input keys never written to the audit log
  handler: (input: z.infer<I>, ctx: ActionContext) => Promise<z.infer<O>>
}
export function defineAction<I extends z.ZodObject, O extends z.ZodType>(
  def: ActionDefinition<I, O>,
): ActionDefinition<I, O>

// result.ts
export type ErrorCode =
  'not_found' | 'invalid_input' | 'forbidden' | 'confirmation_required' | 'handler_error'
export type Result<T> =
  | { ok: true; output: T }
  | { ok: false; error: { code: ErrorCode; message: string; issues?: z.core.$ZodIssue[] } }

// registry.ts
export interface CallOptions {
  actor: Actor
  confirmed?: boolean
}
export interface Registry {
  register(action: ActionDefinition<any, any>): void // throws on duplicate or malformed name
  get(name: string): ActionDefinition<any, any> | undefined
  list(): ActionDefinition<any, any>[]
  call(name: string, input: unknown, options: CallOptions): Promise<Result<unknown>>
}
export function createRegistry(): Registry
```

Call order: find action, validate input with `input.strict()`, `can(actor, permission)`, confirm gate, handler, validate output. The confirm gate returns `confirmation_required` when `risk === 'destructive'`, `confirmed !== true`, and the actor type is `admin` or `customer`. `system` always passes `can`.

- [ ] **Step 1:** Write failing tests in `registry.test.ts`, using an action `order.refund` (`input: { orderId: string, reason: string }`, `permission: 'sales.order.refund'`, `risk: 'destructive'`) and `catalog.ping` (`input: {}`, `permission: null`, `risk: 'read'`, returns `{ pong: true }`):

```ts
test('public read action succeeds for a guest', ...)            // ok: true, output { pong: true }
test('unknown action returns not_found', ...)
test('missing field returns invalid_input with issues', ...)     // issues[0].path equals ['reason']
test('unknown extra key returns invalid_input', ...)             // { orderId, reason, hack: 1 }
test('actor without permission gets forbidden', ...)
test('wildcard permission is allowed', ...)                      // permissions: new Set(['*'])
test('destructive action needs confirmation for an admin', ...)  // confirmation_required, handler not called
test('destructive action runs when confirmed', ...)
test('handler error is reported without leaking its message', ...) // message 'Action failed', not 'db password is x'
test('output that violates the schema is a handler_error', ...)
test('registering the same name twice throws', ...)
test('a name that is not module.verb throws', ...)               // 'Refund' and 'order' both throw
```

- [ ] **Step 2:** Run `./dev pnpm test`. Expected: FAIL, modules not found.
- [ ] **Step 3:** Implement the four files to the signatures above.
- [ ] **Step 4:** Run `./dev pnpm test && ./dev pnpm typecheck && ./dev pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): add actions, actors and the call path`, open the pull request, merge when green.

### Task 4: Events and pipelines

**Files:**

- Create: `packages/core/src/events.ts`, `packages/core/src/pipeline.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/events.test.ts`, `packages/core/src/pipeline.test.ts`

**Interfaces:**

- Produces:

```ts
// events.ts
export interface EventDefinition<P extends z.ZodType> {
  name: string
  payload: P
}
export function defineEvent<P extends z.ZodType>(name: string, payload: P): EventDefinition<P>
export interface Subscriber<P extends z.ZodType> {
  event: EventDefinition<P>
  module: string
  handler: (payload: z.infer<P>) => Promise<void>
}
export interface EventBus {
  subscribe<P extends z.ZodType>(subscriber: Subscriber<P>): void
  emit<P extends z.ZodType>(event: EventDefinition<P>, payload: z.infer<P>): Promise<void>
  subscribers(eventName: string): { module: string }[]
}
export function createEventBus(options?: {
  onError?: (error: unknown, info: { event: string; module: string }) => void
}): EventBus

// pipeline.ts
export interface PipelineDefinition<T> {
  name: string
}
export function definePipeline<T>(name: string): PipelineDefinition<T>
export interface Step<T> {
  pipeline: PipelineDefinition<T>
  name: string
  module: string
  order: number
  run: (value: T) => Promise<T> | T
}
export interface TraceEntry<T> {
  step: string
  module: string
  before: T
  after: T
}
export interface Pipelines {
  addStep<T>(step: Step<T>): void // throws on duplicate (pipeline, module, name)
  run<T>(pipeline: PipelineDefinition<T>, initial: T): Promise<{ value: T; trace: TraceEntry<T>[] }>
  steps(pipelineName: string): { step: string; module: string; order: number }[]
}
export function createPipelines(): Pipelines
```

`emit` validates the payload, then awaits subscribers one by one in subscription order. Steps run sorted by `order`, then `module`, then `name`.

- [ ] **Step 1:** Write failing tests:

```ts
// events.test.ts
test('subscribers receive the payload in subscription order', ...)
test('a throwing subscriber does not stop the others and is reported to onError', ...)
test('emit rejects a payload that violates the schema', ...)
test('subscribers() lists modules for inspect', ...)

// pipeline.test.ts, pipeline 'price.calculate' over { amount: number }
test('steps run by order and the value flows through', ...)   // base 100, +10 (order 10), x2 (order 20) = 220
test('equal order is resolved by module then step name', ...) // deterministic across registration order
test('trace records before and after for every step', ...)    // trace[0] = { step, module, before: {amount:100}, after: {amount:110} }
test('a pipeline with no steps returns the initial value', ...)
test('adding the same step twice throws', ...)
```

- [ ] **Step 2:** Run `./dev pnpm test`. Expected: FAIL.
- [ ] **Step 3:** Implement both files.
- [ ] **Step 4:** Run tests, typecheck, lint. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): add typed events and traced pipelines`, open the pull request, merge when green.

### Task 5: Modules and the application

**Files:**

- Create: `packages/core/src/module.ts`, `packages/core/src/app.ts`
- Create: `modules/sample/package.json`, `modules/sample/tsconfig.json`, `modules/sample/src/index.ts` (package `@aicommerce/module-sample`)
- Modify: `packages/core/src/index.ts`, `pnpm-workspace.yaml` (add `modules/*`)
- Test: `packages/core/src/app.test.ts`, `modules/sample/src/index.test.ts`

**Interfaces:**

- Consumes: `createRegistry`, `createEventBus`, `createPipelines` and their types from Tasks 3 and 4.
- Produces:

```ts
// module.ts
export interface ModuleDefinition {
  name: string // lower case, a-z and dashes
  depends?: string[]
  actions?: ActionDefinition<any, any>[]
  subscribers?: Subscriber<any>[]
  steps?: Step<any>[]
  wraps?: ActionWrap[]
}
// A wrap runs around an action's handler: after validation and the permission check,
// before output validation. Lower order is outermost. Ties: module name.
export interface ActionWrap {
  action: string
  module: string
  order: number
  wrap: (input: any, ctx: ActionContext, next: (input: any) => Promise<any>) => Promise<any>
}
export function defineModule(def: ModuleDefinition): ModuleDefinition

// app.ts
export interface App {
  registry: Registry
  events: EventBus
  pipelines: Pipelines
  modules: string[] // enabled modules in load order
  inspect(kind: 'action' | 'event' | 'pipeline', name: string): unknown
}
export function createApp(options: { modules: ModuleDefinition[]; enabled: string[] }): App
```

`createApp` loads only modules named in `enabled`, in dependency order. It throws `Error` with these exact prefixes: `Unknown module: `, `Module "<a>" depends on "<b>", which is not enabled`, `Dependency cycle: a -> b -> a`. A subscriber, step or wrap whose `module` field differs from the declaring module's name throws.
`Registry` gains `addWrap(wrap: ActionWrap): void`, used only by `createApp`. Replaceable services
(`provides`) are part of M0b.

The sample module (`sample`) is what a third party would write: action `sample.greet` (`input: { name: string }`, public, read, returns `{ greeting: string }`), which runs pipeline `sample.greeting` over `{ text: string }`. A second module in its test (`sample-loud`, depends on `sample`) adds a step that upper-cases the text.

- [ ] **Step 1:** Write failing tests:

```ts
// app.test.ts
test('enabled modules load in dependency order', ...)             // enabled ['b','a'], b depends on a: modules = ['a','b']
test('a disabled module contributes nothing', ...)                // registry.get('b.act') is undefined
test('unknown module name fails with a clear error', ...)
test('enabling a module without its dependency fails', ...)
test('a dependency cycle fails and names the cycle', ...)
test('a wrap can change the input before and the output after', ...)
test('a wrap can answer without calling next', ...)
test('wraps run in order, lowest outermost', ...)
test('a wrap never runs when the actor lacks permission', ...)    // forbidden, wrap not called
test('output changed by a wrap is still validated', ...)          // malformed output: handler_error
test('a wrap for an unknown action fails at startup', ...)        // 'Module "x" wraps unknown action "y"'
test('inspect action returns module, permission, risk and wraps', ...)
test('inspect pipeline returns steps in run order', ...)
test('inspect event returns subscribing modules', ...)

// modules/sample/src/index.test.ts
test('sample.greet works through the registry', ...)              // { greeting: 'Hello, Ada' }
test('another module changes the result through the pipeline', ...) // with sample-loud: 'HELLO, ADA'
test('with sample-loud disabled the result is unchanged', ...)
```

- [ ] **Step 2:** Run `./dev pnpm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `module.ts`, `app.ts` and the sample module.
- [ ] **Step 4:** Run tests, typecheck, lint, build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): add modules, dependency loading and inspect`, open the pull request, merge when green.

### Task 6: Database and the audit log

**Files:**

- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/vitest.integration.config.ts`, `packages/db/src/index.ts`, `packages/db/src/client.ts`, `packages/db/src/migrate.ts`
- Create: `packages/core/src/audit.ts`, `packages/core/migrations/0001_audit_log.sql`
- Modify: `packages/core/src/registry.ts` (optional `audit` and `transaction` hooks), `packages/core/src/index.ts`, `turbo.json` (`test:integration` task)
- Test: `packages/db/src/migrate.integration.test.ts`, `packages/core/src/audit.integration.test.ts`

**Interfaces:**

- Consumes: `Registry`, `CallOptions`, `Result`, `ActionDefinition.redact` from Task 3.
- Produces:

```ts
// @aicommerce/db
export type Db = PostgresJsDatabase
export function createDb(url: string): { db: Db; close: () => Promise<void> }
export function runMigrations(db: Db, sources: { module: string; dir: string }[]): Promise<string[]>
// applies each *.sql once, in file-name order per module, recorded in table `migrations` (module, name, applied_at)

// core/audit.ts
export interface AuditEntry {
  actorType: ActorType
  actorId: string | null
  onBehalfOf: string | null
  action: string
  input: unknown
  outcome: 'ok' | ErrorCode
  durationMs: number
}
export interface AuditSink {
  write(entry: AuditEntry): Promise<void>
}
export function createDbAuditSink(db: Db): AuditSink
export function redactInput(input: unknown, keys: string[]): unknown // replaces values with '[redacted]'

// registry.ts
export function createRegistry(options?: {
  audit?: AuditSink
  transaction?: <T>(fn: () => Promise<T>) => Promise<T>
}): Registry
```

Table `audit_log`: `id bigserial primary key`, `at timestamptz not null default now()`, `actor_type text not null`, `actor_id text`, `on_behalf_of text`, `action text not null`, `input jsonb not null`, `outcome text not null`, `duration_ms integer not null`. A trigger raises an exception on `UPDATE` or `DELETE`. The audit row is written outside the handler's transaction, for every outcome including `not_found`, `invalid_input` and `forbidden`. Invalid input is stored after redaction of the action's `redact` keys; for `not_found` the input is stored as `{}`.

- [ ] **Step 1:** Write failing integration tests (each test file creates and drops its own schema so runs are isolated):

```ts
// migrate.integration.test.ts
test('migrations apply once and are recorded', ...)        // second run returns []
test('a failing migration rolls back and is not recorded', ...)

// audit.integration.test.ts
test('a successful call writes one row with outcome ok', ...)
test('a forbidden call is audited', ...)
test('an invalid call is audited', ...)
test('a throwing handler rolls back its writes but is audited as handler_error', ...)
test('redacted keys are stored as [redacted]', ...)        // action with redact: ['password']
test('the AI acting for an admin records on_behalf_of', ...)
test('audit rows cannot be updated or deleted', ...)       // both statements reject
```

- [ ] **Step 2:** Run `./dev pnpm test:integration`. Expected: FAIL.
- [ ] **Step 3:** Implement `packages/db`, the migration, `audit.ts`, and the registry hooks. Unit tests from Task 3 must still pass with no options.
- [ ] **Step 4:** Run `./dev pnpm test && ./dev pnpm test:integration && ./dev pnpm typecheck && ./dev pnpm lint && ./dev pnpm build`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): add database, migrations and append-only audit log`, open the pull request, merge when green.
- [ ] **Step 6:** Update `PROGRESS.md` and Notion (11 · Build log, 03 · Roadmap: M0 in progress, M0a done).
