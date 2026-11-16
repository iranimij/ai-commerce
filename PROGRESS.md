# Progress

Read this first, then the Notion page "AI Commerce" (Start here section).

## Current state (2026-11-16)

- Planning is finished and approved by Iman.
- Design: `docs/superpowers/specs/2026-11-15-ai-commerce-design.md`.
- **M0a is done.** It was merged in PRs #7, #8, #16 to #21 and reviewed once across the whole
  milestone. One critical and nine important findings were fixed in #21.
  - Docker environment: `./dev`, Node 24, PostgreSQL 17, Mailpit.
  - CI, CodeQL and Dependabot; `main` is protected.
  - `@aicommerce/core`:
    - actions and the call path;
    - events, delivered after commit;
    - traced pipelines;
    - modules with dependency loading, wraps and `inspect`;
    - audit and transaction hooks.
  - `@aicommerce/db`:
    - PostgreSQL through Drizzle, with `transaction()` and `current()`;
    - SQL migrations per module;
    - the append-only `audit_log`.
  - `modules/sample` proves that a third-party module can change behaviour.
  - Tests: 71 unit and 14 integration.
- **M0b is done** (PRs #23 to #35). One whole-branch review found no critical and five
  important issues, all fixed in #35 with tests.
  - `@aicommerce/core`: services, handler errors, module namespaces, privacy classes and
    `toModel`, resources (seven actions each), attributes, settings, jobs.
  - `@aicommerce/db`: the runtime role `aicommerce_app` (append-only audit and revisions),
    migration checksums, a PostgreSQL rate limiter, revisions, encrypted settings, the job queue
    and worker.
  - `@aicommerce/auth`: admin sign-in through Better Auth, mandatory TOTP, roles.
  - `modules/system` (attributes, settings, jobs) and `modules/access` (roles, admins).
  - `apps/server`: the HTTP API, OpenAPI, CSRF and rate limits, `main.ts`, and
    `docker compose up server`.
  - Docs: `docs/guides/`, `docs/security/threat-model-m0b.md`, `docs/decisions/log.md`.
  - Tests: 142 unit and 107 integration, including the M0b acceptance test over HTTP.
- **M0c is done** (PRs #38 to #58). Tasks 8, 9 and 10, the review and its fixes were built by
  parallel agents. One whole-milestone review found no critical and six important issues, all
  fixed in #52 and #54 with tests.
  - `@aicommerce/i18n`: English and Persian catalogs, ICU, right-to-left.
  - Module switching: presets `minimal` and `full`, `module.*` actions, reloads in every process
    without a restart (`apps/server/src/app-host.ts`).
  - `modules/setup` and the setup page (`apps/admin`): a one-time token, the owner with
    mandatory 2FA, the shop, features, finish.
  - `@aicommerce/ui`: tokens, light and dark themes, 12 accessible components, and the Orbit logo.
  - `@aicommerce/cli` (`ai-commerce`): dev, migrate, inspect, module, add (with a declaration
    review and a trial build), backup and restore.
  - `create-aicommerce` and the production image (admin, server and worker under one supervisor).
  - Playwright e2e (`./dev e2e`, a required CI check): 8 tests on desktop and phone sizes.
  - Docs: guides for i18n, the CLI, module switching and installing;
    `docs/security/threat-model-m0c.md`; decisions 94 to 142.
  - QA gate: report in Notion 08 · Testing and QA. One real bug found and fixed (#57).
  - Tests: 190 unit, 139 integration and 16 end-to-end.
- Logo: Iman chose C, "Orbit a" (decision 94). It is the `Logo` component and
  `packages/ui/assets/*.svg`.

## Next

1. M1a (catalog, media, search, SEO): `docs/superpowers/plans/2026-11-16-m1a-catalog-search-seo.md`.
   Then M1b (dashboard, storefront, inline editing) and M1c (the AI admin and MCP).

## Rules for code written on top of M0b

- A nested object in an action's input must be `z.strictObject`; `register` rejects anything
  else.
- Handlers must await everything. `db.current()` is only valid during the call.
- Events emitted in a handler reach subscribers after commit, and only if the call succeeded.
- Read actions do not run in a transaction and must not write.
- Run migrations over a direct PostgreSQL connection, never through PgBouncer in transaction
  mode.
- Every public action (`permission: null`) must be listed in
  `apps/server/security/public-actions.json`.
- Store timestamps as `timestamptz(3)` and write `date_trunc('milliseconds', now())`; a rounded
  `now()` can land in the future.
- Jobs write through `ctx.call`, so their work is audited. Make job handlers idempotent.
- Never chain a merge after a local test run in one command: gate the merge on the result.
- The guides in `docs/guides/` are the contract reference: update them with the contract.

## Deferred minors from the M0b review (pick up where they fit)

- `setting.set` has no expected version: two admins setting one key, last write wins.
- `job.retry` on a failed job whose key already has an active job is a 500; make it `conflict`.
- `enqueue` can return id "undefined" if the conflicting job finishes between insert and select.
- Crafted cursors and `revisionId` above the int8 maximum give 500 instead of 400.
- `admin.set-roles` can remove from a superior a role the caller holds; `admin.disable` needs the
  target's permissions. Decide whether removing roles should too.
- A disabled admin gets 401 (treated as a guest), not 403.

## Deferred minors from the M0c review (pick up where they fit)

- A NOTIFY sent while a process's LISTEN connection reconnects is lost; that process keeps the
  old module set until the next change. Fix: reload in postgres.js's `onlisten` callback.
- Two module changes at the same moment can lose one (each writes the full list). Fix: an
  advisory transaction lock in enable, disable and finish.
- `restore` accepts any custom-format dump, not only an AI Commerce backup.
- `add` can leave `node_modules` out of step with the lockfile when it upgrades an existing
  dependency and is then rejected.
- During start-up the admin answers `/healthz` with 500 until the server listens.
- Two CSP "inline style" warnings in Chrome's console on the setup page, of unknown source.

## Standing rules

- Docker only. Use Iman's Chrome for manual QA.
- One pull request per section; merge it without asking once CI is green; never merge red.
- No Claude or Anthropic attribution in commits or pull requests.
- Unit, integration and end-to-end tests for everything; manual QA gate per milestone.
- Update Notion (build log, roadmap, decisions, parity map) and this file at the end of every
  session.
- English everywhere.

## Open items

- Persian strings need a review by a native speaker.

- Sessions slide (decision 93): choose an absolute session cap, or keep sliding sessions.
- Check decisions 21 and 34 in `docs/decisions/log.md`: attributed to Claude where Notion was
  unclear.

- Register the `@aicommerce` npm scope and an image registry; publish at 1.0.
- Gemini API key (M1): create it in the browser and store it in a git-ignored `.env`.
- Shopify development store for M3 testing: Iman provides it.
- Dependabot PRs #9 to #15 are left for Iman. #9 (Node 26 image) and #15 (`@types/node` 26)
  conflict with the Node 24 pin; #10 to #14 bump action versions and pass CI.
- Project website at aicommerce.iranimij.net: built in M12, when the product is finished (design
  M12). DNS is in place. Iman will provide the deploy secrets and do the one-time server setup.
- Own models and local models are postponed (decision 42): hosted Gemini, Claude and OpenAI only.
  Reconsider no sooner than one year after AI Commerce is in real use.
