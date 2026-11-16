# M0c: Installer, CLI, Design System and i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M0c finishes M0. A new shop is created with one command and set up in the browser:

- a one-time token;
- the owner with 2FA;
- the shop basics;
- a preset or features picked one by one;
- an optional AI key.

Modules switch on and off at run time, and their data is kept. A developer gets the `ai-commerce` CLI. Every visible string goes through the translation layer, and every screen is built from one accessible design system.

**Architecture:**

- `packages/i18n`: ICU message catalogs, and a translator with locale fallback and text direction.
- `packages/core`: gains module metadata, presets and dependency resolution. It stays database-free.
- Module state lives in a `module_state` table. `modules/system` changes it through `module.*` actions, which send a PostgreSQL `NOTIFY` on commit. Each server process then rebuilds its app (an `AppHost`), running the migrations of any newly enabled module.
- `modules/setup`: the setup actions, guarded by a one-time token.
- `apps/admin`: a Next.js app. In M0c it holds only the setup page and proxies `/api` to the server on the same origin.
- `packages/ui`: tokens and React components.
- `packages/cli`: the `ai-commerce` command.
- `packages/create`: the `npm create @aicommerce` scaffold.
- Playwright: runs end to end in its own container.

**Tech Stack:**

- Already in use: Node 24, TypeScript 6, Zod 4, Drizzle, PostgreSQL 17, Hono, Better Auth, Vitest.
- New in M0c:
  - `intl-messageformat`;
  - Next.js and React;
  - Tailwind CSS 4 and Radix primitives;
  - Testing Library with jsdom;
  - `axe-core` (with `@axe-core/playwright`);
  - Playwright;
  - `postgresql-client-17` in the app image, for backup and restore.

**Spec:** `docs/superpowers/specs/2026-11-15-ai-commerce-design.md`. The sections that matter most:

- Decisions 4, 6, 8, 9 and 19;
- 4.1 (repository) and 4.2a (overrides);
- 5.2 (testing), 5.3 (QA gate), 5.5 (design) and 5.6 (languages, operations);
- 6 · M0 (installer steps and "done when");
- 15, Magento lessons 2, 10, 12 and 18.

Also read `PROGRESS.md`, especially "Rules for code written on top of M0b".

M0 is split into three plans. This is the third.

| Plan      | Covers                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| M0a, done | Environment, CI, core registry, events, pipelines, modules, audit                                               |
| M0b, done | Services, privacy classes, resources, revisions, attributes, settings, jobs, auth and roles, server and OpenAPI |
| M0c, this | i18n, module switching, installer, CLI, design system, end-to-end tests, the contract test, the M0 QA gate      |

**Rulings in this plan.** These are recorded in Notion 10 and `docs/decisions/log.md` when M0c closes.

- **`upgrade` waits for the first contract change.** No contract has a second version yet, so there is nothing to report. `migrate` covers running migrations. The contract version field arrives with the first breaking change.
- **The admin proxies `/api` to the server.** Calling actions in-process from Next.js is decided in M1 with the dashboard. Being on the same origin keeps the cookie, CSRF and Origin rules as they are.
- **Presets.** `minimal` and `full` are defined now. `starter` and `standard` arrive in M2, when their modules exist. Today `minimal` is the required modules and `full` is every first-party module.
- **Sample data and import** are listed on the setup page as "available from M1" and "available from M3", but are not built.
- **Tokens use logo proposal A (Spark bag)** until Iman chooses. The brand colours live in one file.
- **Languages:** English and Persian (right-to-left). The Persian strings are marked for review by a native speaker.
- **The Docker image** is built locally and in CI. Publishing it, and the npm packages, waits for the `@aicommerce` npm scope (an open item).

## Global Constraints

- Docker only: every command runs as `./dev <command>`, and Playwright runs in its own container. Nothing is installed on the host.
- Node 24, TypeScript `strict`, ES modules, package scope `@aicommerce/*`, MIT.
- One pull request per task, merged without asking once CI is green, never merged red. Never chain a merge after a local test run.
- No Claude or Anthropic attribution in commits or pull requests.
- Testing:
  - Unit tests cover logic.
  - Integration tests run against real PostgreSQL, one schema per test file.
  - End-to-end tests run in Playwright, at desktop (1280×800) and mobile (390×844) sizes, with an axe check on every page.
- `packages/core` imports no database, HTTP, auth, i18n or UI library.
- Every path to data goes through an action. Every public action is listed in `apps/server/security/public-actions.json`.
- Every visible string goes through `packages/i18n` (spec 5.6). An unknown key throws, so tests catch it. A missing translation falls back to English, so a user never sees a raw key.
- Design:
  - One design system with tokens, light and dark, right-to-left, from 360 px up.
  - WCAG 2.2 AA, keyboard and screen-reader usable.
  - Empty, loading and error states on every screen (spec 5.5).
- Off means absent: a disabled module has no action, setting, job or migration run. Its tables and rows stay (decision 6).
- Third-party code is installed only from the CLI on the server, never from a web page (decision 9).
- For any library new to M0c (Next.js, Tailwind 4, Radix, intl-messageformat, Playwright): pin the current stable version, read its documentation for that version, and use the names it gives.

## Review Focus

1. **Someone reaches the setup page before the owner.** Without the token, every setup action is refused, guessing is rate-limited, and after `setup.finish` every setup action is refused even with the token. (Task 4: "setup actions need the token", "a finished setup refuses everything")
2. **Setup interrupted halfway.** The browser is closed after the owner is created but before 2FA or the finish. Reloading resumes at the right step, and a second owner can never be created. (Task 4: "status reports the next step", "create-owner twice is a conflict")
3. **Switching a module that others depend on.** Disabling one that an enabled module needs is refused, naming the dependents. Enabling one enables its dependencies, and says which. Data survives off and on. (Task 2: "disabling a needed module names its dependents"; Task 3: "off and on keeps the notes")
4. **Restore with the wrong file or a running shop.** `restore` needs confirmation, refuses a file that is not a backup, and warns when the secret key will not match. (Task 6: "restore refuses a file that is not a backup")
5. **`add` of a package the user rejects, or that is not a module.** Nothing changes in the project. (Task 7: "a rejected add changes nothing", "a package without a module is refused")

---

### Task 1: Translation layer (`packages/i18n`)

**Files:**

- Create:
  - `packages/i18n/` (package `@aicommerce/i18n`)
  - `src/index.ts`, `src/index.test.ts`
  - `src/locales.ts` (the list of supported locales and their direction)

**Interfaces:**

- Produces:
  - `defineMessages<const M extends Record<string, string>>(namespace: string, english: M): MessageCatalog<M>`. Keys are `namespace.key`.
  - `createTranslator({ locale: string, catalogs: MessageCatalog[], translations: Record<locale, Record<key, string>>, onMissing?: (key, locale) => void }): Translator`.
  - `Translator = { locale, dir: 'ltr' | 'rtl', t(key, values?): string, has(key): boolean }`.
  - `directionOf(locale): 'ltr' | 'rtl'`.
  - `SUPPORTED_LOCALES = ['en', 'fa']`.
  - `negotiateLocale(acceptLanguage: string | null, supported): string`.

- [ ] **Step 1: Write the failing tests**
  - `'t formats ICU arguments and plurals'`: `{count, plural, one {# module} other {# modules}}` gives "1 module" and "3 modules".
  - `'a missing translation falls back to English and reports once'`.
  - `'an unknown key throws'`: `t('nope.x')` throws "Unknown message key".
  - `'fa is rtl, en is ltr'`.
  - `'negotiateLocale picks fa-IR as fa and falls back to en'`.
  - `'a translation with different ICU arguments than English is rejected'`: `createTranslator` throws, naming the key.
- [ ] **Step 2: Run them.** Run `./dev pnpm --filter @aicommerce/i18n test`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** using `intl-messageformat`. Cache each formatter per key and locale.
- [ ] **Step 4: Run them.** Expected: PASS. Then run `./dev pnpm lint typecheck test`.
- [ ] **Step 5: Commit** `feat(i18n): add the translation layer`, then open the PR and merge it.

### Task 2: Module metadata, presets and switching (`core`, `db`, `modules/system`)

**Files:**

- Modify:
  - `packages/core/src/module.ts`: `label`, `description`, `required?: boolean`.
  - `packages/core/src/index.ts`
  - `modules/*/src/index.ts`: labels.
  - `modules/system/src/index.ts`
- Create:
  - `packages/core/src/presets.ts` (+ test)
  - `packages/db/migrations/0007_module_state.sql`
  - `packages/db/src/modules.ts` (+ integration test)
  - `modules/system/src/modules.ts` (+ integration test)

**Interfaces:**

- Produces, in core:
  - `resolveModules(all: ModuleDefinition[], selected: string[]): { enabled: string[]; added: { module: string; requiredBy: string }[] }`. It adds every `required` module and every transitive dependency.
  - `dependentsOf(all, enabled, name): string[]`.
  - `PRESETS: Record<'minimal' | 'full', (all: ModuleDefinition[]) => string[]>`.
  - Service `moduleState = defineService<ModuleStateStore>('core.module-state')`, where `ModuleStateStore = { enabled(): Promise<string[] | null>; set(enabled: string[], meta: WriteMeta): Promise<void> }`. `null` means never set, which is a fresh install.
- Produces, in db:
  - The `module_state` table: one row per module (`name text primary key, enabled boolean, changed_at timestamptz(3)`).
  - `createPgModuleState(database)`: `set` writes a revision (resource `module`) and runs `select pg_notify('aicommerce_modules', '')` in the call's transaction.
  - `MODULES_CHANNEL = 'aicommerce_modules'`.
- Produces, in system:
  - `module.list` (read, `module.read`) → `{ name, label, description, enabled, required, depends }[]`.
  - `module.enable` (write, `module.manage`) → `{ enabled: string[], added }`.
  - `module.disable` (destructive, `module.manage`) → `{ enabled: string[] }`.

- [ ] **Step 1: Write the failing tests.** Unit:
  - `'resolveModules adds required modules and dependencies, and says why'`;
  - `'an unknown module is refused'`;
  - `'minimal is the required modules; full is every module'`.

  Integration:
  - `'module.enable enables dependencies and lists them in added'`;
  - `'disabling a needed module names its dependents'` (conflict, message names them);
  - `'a required module cannot be disabled'`;
  - `'set notifies aicommerce_modules only on commit'` (a rolled-back call sends nothing);
  - `'module changes have revisions and audit rows'`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** `system` and `access` are `required`. `module.disable` stays `destructive`, so it asks for confirmation; its description says the data is kept.
- [ ] **Step 4: Run** `./dev pnpm lint typecheck test test:integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add module metadata, presets and run-time switching`, then open the PR and merge it.

### Task 3: The server reloads modules at run time, and the contract test

**Files:**

- Create:
  - `apps/server/src/app-host.ts` (+ integration test)
  - `apps/server/src/contract.integration.test.ts`
- Modify:
  - `apps/server/src/wiring.ts`: modules come from `moduleState` and fall back to the env list on a fresh install.
  - `apps/server/src/server.ts`: it takes `host: AppHost` instead of `app`, and reads `host.current()` per request.
  - `apps/server/src/main.ts`, `testkit.ts`
  - `.github/workflows/ci.yml`: a job `contract`.

**Interfaces:**

- Produces:
  - `createAppHost({ database, owner: Database, secretKey, auth, onError? }): Promise<AppHost>`.
  - `AppHost = { current(): App; reload(): Promise<void>; listen(): Promise<() => Promise<void>> }`.
  - `reload` reads the enabled list, runs migrations for it with the owner handle and the app role, builds a new app and swaps it in. A failed reload keeps the old app and reports the error.
  - `listen` subscribes to `MODULES_CHANNEL` and reloads on each notification.
  - The worker reads `host.current()` each round.

- [ ] **Step 1: Write the failing tests.**
  - `'a module enabled in another process appears after the notification'`: two hosts on one schema; enabling on one makes `sample.greet` exist on the other within 2 s.
  - `'off and on keeps the notes'`: create notes, disable `sample`, and `note.list` is `not_found` (404 over HTTP) while the rows are still in `sample_note`; enable it again and the same notes come back.
  - `'enabling a module runs its migrations'`: on a fresh schema with `sample` off, `sample_note` does not exist; after `module.enable` it does.
  - `'a reload that fails keeps the running app'`.
  - **Contract** (`contract.integration.test.ts`, the M0 "done when"):
    - `sample.greet` gives 200 for a guest and 400 for `{ name: '' }`;
    - `note.create` gives 403 for an admin without `note.write`;
    - each of the three calls has an audit row with the right outcome.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Requests that started before a swap finish on the old app. The CI job `contract` runs `pnpm --filter @aicommerce/module-sample test test:integration` and the contract test, and is a required check.
- [ ] **Step 4: Run** the full suite. Expected: PASS. Then run `docker compose up server`: disable `sample` by `curl` as an owner, and `sample.greet` gives 404 without a restart.
- [ ] **Step 5: Commit** `feat(server): switch modules at run time without a restart`, then open the PR and merge it. Ask for `contract` to become a required check through `gh api` branch protection.

### Task 4: Setup actions and the one-time token (`modules/setup`)

**Files:**

- Create:
  - `modules/setup/` (package `@aicommerce/module-setup`, required, namespaces `setup` and `shop`)
  - `src/index.ts`, `src/token.ts`
  - `src/setup.integration.test.ts`
  - `migrations/0001_setup.sql`
- Modify:
  - `apps/server/src/main.ts`: prints the token.
  - `apps/server/security/public-actions.json`

**Interfaces:**

- Produces:
  - The table `setup_state`: a single row `{ token_hash text, finished_at timestamptz(3) }`.
  - `issueSetupToken(database): Promise<string | null>`. It returns a fresh 32-byte base64url token while setup is unfinished and no owner exists (otherwise `null`), and stores only its SHA-256.
  - `main.ts` prints the token in a framed block, with the URL `<PUBLIC_URL>/setup?token=…`.
  - Settings:
    - `shop.name` (1 to 100);
    - `shop.country` (ISO 3166-1 alpha-2);
    - `shop.currency` (ISO 4217);
    - `shop.language` (one of `SUPPORTED_LOCALES`);
    - `setup.ai-key` (secret, optional).
  - Actions (all public: they check the token or the owner themselves):
    - `setup.status` → `{ finished, next: 'owner' | 'two-factor' | 'shop' | 'modules' | 'done', database: { ok, version } }`;
    - `setup.create-owner { token, email, name, password }`;
    - `setup.save-shop { token, name, country, currency, language, aiKey? }`;
    - `setup.choose-modules { token, preset?: 'minimal' | 'full', modules?: string[] }` → `resolveModules` output;
    - `setup.finish { token }`. It needs the owner to have 2FA, enables the chosen modules, writes `finished_at`, and drops the token.
  - Every setup action except `setup.status` refuses with `forbidden` "Setup is finished" once finished.

- [ ] **Step 1: Write the failing tests.**
  - `'setup actions need the token'`: a wrong or missing token gives `forbidden`, and the token is compared in constant time.
  - `'guessing the token is rate-limited'`: the 11th wrong token from one address in a minute gives 429 over HTTP.
  - `'status reports the next step'`: owner, then two-factor after the owner exists, then shop, then modules, then done.
  - `'create-owner twice is a conflict'`.
  - `'finish needs the owner to have 2FA'`.
  - `'finish enables the chosen preset and locks setup'`: for `minimal` and `full`.
  - `'a finished setup refuses everything'`: even with the old token, and `issueSetupToken` returns `null`.
  - `'the AI key is stored as a secret setting'`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Token checks run through the rate limiter with the key `setup:<address>` (10 a minute). The setup actions bypass `can()` by being public, so each handler checks the token first. Add `setup.*` to the public-actions list, with a comment.
- [ ] **Step 4: Run** the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the setup actions and the one-time setup token`, then open the PR and merge it.

### Task 5: Design system (`packages/ui`)

**Files:**

- Create:
  - `packages/ui/` (package `@aicommerce/ui`)
  - `src/tokens.css`: CSS variables for colour, space, radius, type and focus. Light by default, dark under `[data-theme=dark]` and `prefers-color-scheme`. Logical properties only, so right-to-left needs no extra rules.
  - `src/brand.css`: the logo palette, the one file to change.
  - `src/components/`: `Button`, `TextField` (label, hint, error, `aria-describedby`), `Select`, `Checkbox`, `RadioCards` (for presets), `Alert`, `Card`, `Stepper`, `Spinner`, `EmptyState`, `ThemeToggle`.
  - `src/*.test.tsx`
  - `docs/guides/ui.md`

**Interfaces:**

- Produces:
  - Components with typed props. Every visible text comes in as a prop; the package itself holds no English.
  - A `UiProvider { dir, theme }`.
  - Tailwind 4 preset `@aicommerce/ui/tailwind.css`.

- [ ] **Step 1: Write the failing tests** (Vitest with jsdom and Testing Library):
  - `'TextField links its label, hint and error'`;
  - `'Button shows busy state and blocks double submit'`;
  - `'RadioCards is keyboard operable with arrow keys'`;
  - `'every component passes axe'`, rendered light and dark and in `dir=rtl`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** on Radix primitives where one exists (Select, Checkbox, RadioGroup). Colour contrast is at least 4.5:1, checked by a unit test that reads the token values.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): add the design system`, then open the PR and merge it.

### Task 6: CLI (`packages/cli`): dev, migrate, inspect, module, backup, restore

**Files:**

- Create:
  - `packages/cli/` (package `@aicommerce/cli`, bin `ai-commerce`)
  - `src/main.ts`: `util.parseArgs` with one file per command.
  - `src/commands/*.ts`
  - `src/*.test.ts`
- Modify:
  - `docker/Dockerfile.dev`: adds `postgresql-client-17`.
  - `dev`: `./dev ai-commerce …` runs the CLI.

**Interfaces:**

- Produces:
  - `ai-commerce migrate [--status]`.
  - `ai-commerce inspect <action|pipeline|event|service> <name>`, and `inspect modules`. The output is JSON with `--json`, otherwise a table.
  - `ai-commerce module list|enable|disable <name> [--yes]`, through the `module.*` actions as the system actor.
  - `ai-commerce module create <name>`.
  - `ai-commerce backup [--out <file>]`: `pg_dump --format=custom` to `backups/aicommerce-<ISO time>.dump`. It prints "Keep AICOMMERCE_SECRET_KEY with this backup".
  - `ai-commerce restore <file> [--yes]`.
  - `ai-commerce dev`: migrations, then the server and worker with `node --watch`, plus `next dev` for the admin.
  - Every command returns an exit code: 0 for ok, 1 for an error, 2 for wrong usage.
- `module create <name>` writes `modules/<name>/`:
  - `package.json`, `tsconfig.json` and the vitest configs;
  - `src/index.ts`, with `defineModule` and one `<name>.hello` action;
  - `src/index.test.ts`, which passes as generated;
  - a README.

- [ ] **Step 1: Write the failing tests.**
  - `'inspect action prints the wraps in order'`.
  - `'module create writes a module whose tests pass'`: it runs vitest on the output.
  - `'module create refuses an existing folder or a bad name'`.
  - `'backup then restore brings the data back'` (integration, against the test database).
  - `'restore refuses a file that is not a backup'`: `pg_restore --list` fails, and nothing changes.
  - `'restore without --yes asks and stops on no'`.
  - `'unknown command exits 2 with usage'`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Database URLs come from the same env check as the server (`readEnv` moves to `packages/db/src/env.ts`, re-exported by the server). `restore` uses `--clean --if-exists --single-transaction` with the owner URL, then re-grants the app role.
- [ ] **Step 4: Run them.** Expected: PASS. Also by hand: `./dev ai-commerce inspect action sample.greet` and `./dev ai-commerce backup`.
- [ ] **Step 5: Commit** `feat(cli): add the ai-commerce command`, then open the PR and merge it.

### Task 7: `ai-commerce add`, which shows what an extension declares before it is enabled

**Files:**

- Create: `packages/cli/src/commands/add.ts` (+ test, fixture packages in `test/fixtures/`).
- Modify:
  - `apps/server/src/wiring.ts`: it loads third-party modules listed in `aicommerce.config.json` (`{ "modules": ["<package>"] }`).
  - The config schema goes in `packages/core/src/config.ts`, type only.

**Interfaces:**

- `ai-commerce add <package> [--yes]`:
  1. installs with `pnpm add --ignore-scripts`;
  2. imports the package's default export, which must be a `ModuleDefinition`;
  3. prints its name, dependencies, actions (permission and risk), public actions, settings (secret ones marked), jobs, wraps, service replacements and migrations;
  4. asks to confirm;
  5. on yes, adds it to `aicommerce.config.json`, still disabled (the owner enables it as a module);
  6. on no, or on any error, removes the package again.

- [ ] **Step 1: Write the failing tests.**
  - `'add prints the declarations of a module'`: uses a fixture with one public action and one wrap.
  - `'a rejected add changes nothing'`: `package.json`, the lockfile and the config are byte-identical afterwards.
  - `'a package without a module is refused'`.
  - `'install scripts never run'`: the fixture's `postinstall` writes a file, and the file does not exist.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The fixtures are installed from a local folder (`file:`), so the tests need no network.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(cli): add extensions with a declaration review`, then open the PR and merge it.

### Task 8: The setup page (`apps/admin`)

**Files:**

- Create:
  - `apps/admin/` (Next.js App Router, package `@aicommerce/admin`)
  - `app/setup/page.tsx` and one component per step
  - `messages/en.json`, `messages/fa.json`
  - `next.config.ts`: a rewrite of `/api/*` to `AICOMMERCE_SERVER_URL`, and security headers (CSP with a nonce).
  - `src/*.test.tsx`
- Modify:
  - `compose.yaml`: an `admin` service on `127.0.0.1:3001`, and the server's `AICOMMERCE_PUBLIC_URL` set to the admin origin.

**Interfaces:**

- The steps follow `setup.status.next`. Reloading resumes there, and the token is kept in `sessionStorage` from the URL.
  1. **Database check:** shows the version and "connected", or a plain error with what to check.
  2. **Owner:** email, name, password (12+), then 2FA. The page shows the QR code (rendered locally from `totpURI`, never sent anywhere), the secret key text and backup codes, then verifies one code. It signs in through `/api/auth/*`.
  3. **Shop:** name, country, currency, language, and an optional AI key (a password field).
  4. **Features:** `minimal` or `full` cards, or "choose features", which lists modules with descriptions. Dependencies are ticked automatically, with a line saying which module needs them.
  5. **Import and sample data:** shown disabled, with "available from M3" and "available from M1".
  6. **Done:** a summary with a link to `/api/me`. The dashboard arrives in M1.
- Language: from `Accept-Language`, with a switcher. `dir` is set on `<html>`. There is a theme toggle.
- Every request shows loading, error and retry states. Buttons are disabled while busy.

- [ ] **Step 1: Write the failing tests** (component level):
  - `'the features step ticks dependencies and says why'`;
  - `'the owner step shows server errors next to the right field'`;
  - `'every message key used exists in en and fa'`: scans the source for `t('…')`;
  - `'no step renders an untranslated string'`: the rendered text contains no `.` key patterns.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** with `packages/ui` and `packages/i18n` only. There is no other UI library.
- [ ] **Step 4: Run them.** Expected: PASS. Then by hand: `docker compose up server admin`, and open `http://localhost:3001/setup?token=…` with the printed token.
- [ ] **Step 5: Commit** `feat(admin): add the setup page`, then open the PR and merge it.

### Task 9: `npm create @aicommerce` and the production image

**Files:**

- Create:
  - `packages/create/` (package `@aicommerce/create`, bin `create-aicommerce`)
  - `src/index.ts` (+ test)
  - `templates/`: `compose.yaml`, `.env`, `README.md`, `aicommerce.config.json`
  - `docker/Dockerfile`: a multi-stage build that runs the server, worker and admin in one image. `AICOMMERCE_ROLE` picks the processes; the default is all, under a small Node supervisor in `apps/server/src/supervisor.ts`.
- Modify: `.github/workflows/ci.yml`, which builds the image.

**Interfaces:**

- `create-aicommerce [dir] [--port 3000]`:
  - writes the template into a new or empty folder (refusing a non-empty one);
  - generates `AICOMMERCE_SECRET_KEY` (32 random bytes), `AICOMMERCE_AUTH_SECRET` (48), and the database passwords;
  - writes `.env` with mode 0600;
  - prints the next steps: `docker compose up`, then follow the printed setup link.
- The image tag in the template is `ghcr.io/iranimij/ai-commerce:<version>`. `AICOMMERCE_IMAGE` overrides it (tests use the local `ai-commerce:test`).

- [ ] **Step 1: Write the failing tests.**
  - `'create writes a project with fresh secrets'`: two runs give different keys, and both pass the env check.
  - `'create refuses a non-empty folder'`.
  - `'.env is not readable by others'`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The supervisor starts the server and the admin, and stops both on SIGTERM. The image runs as a non-root user.
- [ ] **Step 4: Run them.** Expected: PASS. Then build the image in CI, and locally with `./dev docker build -f docker/Dockerfile -t ai-commerce:test .`.
- [ ] **Step 5: Commit** `feat: add npm create @aicommerce and the production image`, then open the PR and merge it.

### Task 10: End-to-end tests (Playwright)

**Files:**

- Create:
  - `e2e/` (package `@aicommerce/e2e`): `playwright.config.ts` with desktop and mobile projects
  - `e2e/setup.spec.ts`, `e2e/modules.spec.ts`
  - `e2e/support/`: TOTP from the page's secret, axe check, server log reader for the token
- Modify:
  - `compose.yaml`: a `playwright` service on the official image matching the pinned version, `profiles: [e2e]`.
  - `dev`: `./dev e2e` runs it.
  - `.github/workflows/ci.yml`: a job `e2e`, required, which keeps its traces on failure.

**Interfaces:** the tests use the built image `ai-commerce:test` from Task 9 on a fresh database.

- [ ] **Step 1: Write the failing tests.**
  - `'a fresh install reaches a working shop with minimal'` and `'… with full'`: the whole setup page through to done, then `/api/me` is the owner with 2FA, and `module.list` matches the preset.
  - `'the setup page without the token explains how to get it'`.
  - `'setup resumes after a reload at the 2FA step'`.
  - `'the setup page works right-to-left in Persian'`: `dir=rtl`, no horizontal scroll at 390 px.
  - `'every setup step passes axe in light and dark'`.
  - `'sample off and on keeps its notes'`: through the API as the owner.
  - `'after setup the page says setup is finished'`.
- [ ] **Step 2: Run them.** Run `./dev e2e`. Expected: FAIL until the image and the page are wired; every failure is about missing behaviour, not tooling.
- [ ] **Step 3: Fix what they find.** Each bug gets a unit or integration test as well.
- [ ] **Step 4: Run them.** Expected: PASS for both projects.
- [ ] **Step 5: Commit** `test: add end-to-end tests for setup and module switching`, then open the PR and merge it. Then make `e2e` a required check.

### Task 11: Guides, threat model, decisions, QA gate

**Files:**

- Create:
  - `docs/guides/i18n.md`, `docs/guides/cli.md`, `docs/guides/installing.md`, `docs/guides/module-switching.md`
  - `docs/security/threat-model-m0c.md`
- Modify:
  - `docs/guides/README.md`, `docs/decisions/log.md`
  - `PROGRESS.md`, `README.md` (install section)

- [ ] **Step 1: Write the guides.** Each cites runnable code: `module create` output, the sample module and the setup page.
- [ ] **Step 2: Write the threat model.** It covers:
  - the setup token (who sees the terminal, brute force, the lock after finish);
  - `add` and the supply chain: `--ignore-scripts`, the declaration review, and that importing a package still runs its top-level code (residual risk);
  - backups that hold personal data and need the secret key;
  - reloading modules at run time;
  - the admin's CSP;
  - Persian strings not yet reviewed.
- [ ] **Step 3: Run the QA gate (spec 5.3).**
  1. Write the test plan in Notion 08.
  2. Walk the setup page and module switching in Iman's Chrome at 1280 px and 390 px, in light, dark and right-to-left.
  3. Try bad input, double submit, the back button, a slow network (DevTools throttling), the server down, an expired or wrong token, and a reload at every step.
  4. Log every bug, fix it with a test, retest.
  5. File the report in Notion 08.

  Iman is asked once to scan the 2FA QR code with a real authenticator app and say what issuer name it shows (decision 76). The gate continues without waiting, and the item stays open until Iman answers.
- [ ] **Step 4: Run** `./dev pnpm format:check`, the full suite and `./dev e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `docs: M0c guides, threat model, decisions and QA report`, then open the PR and merge it.

**M0 done when** (spec 6):

- A fresh install reaches a working, empty shop through the setup page, for both `minimal` and `full`.
- The sample module can be switched off and on with its data intact.
- The sample action returns 200, 403 and 400 correctly, and each call is audited.
- All three test levels are green in CI.
- The QA report is filed with no open bugs.
- Notion and `PROGRESS.md` are updated.
