# Decisions log

This file mirrors the Notion page "10 · Decisions log". Every new decision goes to both places.
Newest decisions are appended at the end.

## Product and architecture decisions

### 1 · 2026-11-15 · Iman

Build our own TypeScript core, not on top of Medusa. The action registry must be the core and
cannot be added on top of someone else's. Proposed by Claude.

### 2 · 2026-11-15 · Iman

The product is named AI Commerce.

### 3 · 2026-11-15 · Iman

npm packages use the `@aicommerce` scope, because `ai-commerce` and `create-ai-commerce` are taken.

### 4 · 2026-11-15 · Iman

Fully free under MIT, including Adobe Commerce level features. Best for adoption.

### 5 · 2026-11-15 · Iman

First market is global and Europe. Stripe first, PayPal second.

### 6 · 2026-11-15 · Iman

AI for the admin now; a shopper assistant later as a module. Lower cost and risk at launch.
Replaced by decision 30.

### 7 · 2026-11-15 · Iman

Stack: TypeScript, Node, PostgreSQL, Drizzle, Hono, Zod, Next.js, Tailwind, Radix, Vercel AI SDK,
Better Auth, Vitest, Playwright. One language, few services. Proposed by Claude.

### 8 · 2026-11-15 · Iman

Gemini is the first AI provider, because an API key already exists.

### 9 · 2026-11-15 · Iman

Channels replace website, store and store view. Simpler to learn, same capability. Proposed by
Claude.

### 10 · 2026-11-15 · Iman

Size is a dial: every feature is a module that can be off. Presets are `minimal`, `starter`,
`standard` and `full`. Small shops must not carry the complexity.

### 11 · 2026-11-15 · Iman

A browser installer with a feature picker, protected by a one-time token (the token is Claude's
addition). It prevents takeover of an unconfigured install.

### 12 · 2026-11-15 · Iman

Third-party modules are installed from the server command line only. Installing code from a web
page is a remote-code-execution risk. Proposed by Claude.

### 13 · 2026-11-15 · Iman

Migration from Magento, Shopify and Shopware is an early milestone (M3), so people can move easily.

### 14 · 2026-11-15 · Iman

Full-featured checkout in M2.

### 15 · 2026-11-15 · Iman

Unit, integration and end-to-end tests are required everywhere, plus a manual QA gate per
milestone.

### 16 · 2026-11-15 · Iman

Any scale: a stateless app with adapters for search, cache, queue and files. Very large and very
small shops run on the same platform.

### 17 · 2026-11-15 · Iman

Public GitHub repository `iranimij/ai-commerce`. No AI attribution in commits or pull requests.

### 18 · 2026-11-15 · Iman

One pull request per section, merged by Claude without asking once CI is green.

### 19 · 2026-11-15 · Iman

Standard open-source repository setup: CI, CodeQL, Dependabot, Changesets, templates.

### 20 · 2026-11-15 · Iman

Dashboard and chat are both first-class. The dashboard is laid out like Magento's, with a chat bar
on top. Merchants may not trust a chatbot alone.

### 21 · 2026-11-15 · Claude (product owner)

Three AI trust levels per admin: Guide, Ask, Auto. Each admin decides how much the AI may do.
Proposed in answer to Iman's trust concern.

### 22 · 2026-11-15 · Iman

Docker only: nothing runs on the host except Docker, git and gh.

### 23 · 2026-11-15 · Iman

One chat per milestone; `PROGRESS.md` and Notion are the handover. Replaced by decision 27.

### 24 · 2026-11-15 · Iman

AI duties: admins write standing rules that let the AI do non-critical work on its own, within an
explicit list of allowed actions. Destructive actions are excluded (safety rules by Claude).

### 25 · 2026-11-15 · Iman

AI features are built into the shop, starting with AI-chosen related products. Full list proposed
by Claude.

### 26 · 2026-11-15 · Iman

Model roles: one main model plus specialised models per feature. Our own trained models plug in as
providers later (design by Claude).

### 27 · 2026-11-15 · Iman

All work continues in one long-running chat; Notion and `PROGRESS.md` are the memory. Replaces
decision 23.

### 28 · 2026-11-15 · Iman

Open-source Hugging Face models can run locally in an optional container for moderation,
embeddings, vision and forecasts. The admin chat keeps a strong hosted model (limits by Claude).
Replaced by decision 42.

### 29 · 2026-11-15 · Iman

Model track X1 to X3: our own specialised models published as AI Commerce on Hugging Face, each
only if it beats the open model it replaces (track and rules by Claude). Replaced by decision 42.

### 30 · 2026-11-15 · Iman

A customer chatbot on the storefront, built in M2, with its own model role. Hosted model first,
local and own models as a setting (option A, recommended by Claude). Replaces decision 6. Narrowed
by decision 42 to option A.

### 31 · 2026-11-15 · Iman

The first own model (X1) is the product matcher: candidates by meaning, then ranked for the
customer with a reason. Replaced by decision 42.

### 32 · 2026-11-15 · Iman

AI modes: Private, Hybrid (default), Hosted, Off, chosen in the installer and changeable later
(modes by Claude). Replaced by decision 42.

### 33 · 2026-11-15 · Iman

Results of AI-run queries go to the admin, not to the model; the model gets a digest. Every answer
can show its query (mechanism by Claude).

### 34 · 2026-11-15 · Claude (product owner)

Every field has a privacy class (public, internal, personal, secret), enforced at one AI boundary.
Unclassified means personal; secret can never be sent. From Iman's privacy requirement.

### 35 · 2026-11-15 · Iman

AI locks: the owner can lock any action, module or field from the AI. Sensitive areas are locked by
default (defaults by Claude). The AI can never change locks.

### 36 · 2026-11-15 · Iman

A "what left my server" log of every request sent to a model, with the exact content.

### 37 · 2026-11-15 · Iman

Hosted requests use the provider's no-retention and no-training options where offered. The product
states that provider behaviour cannot be verified (honesty note by Claude).

### 38 · 2026-11-15 · Claude (product owner)

M0 is built in three plans: M0a environment and core; M0b resources, auth and server; M0c CLI,
design system and installer. M0 is too large for one plan.

### 39 · 2026-11-15 · Iman

Overriding: action wraps (before, after, around) and replaceable named services, all declared in
the developer's own module. Only declared contracts can be overridden (contracts by Claude).

### 40 · 2026-11-15 · Iman

Logo: three proposals drawn right after the environment and CI tasks, for Iman to choose.

### 41 · 2026-11-15 · Iman

Sample shop data (every product type, categories, customers, orders) is offered in the installer,
built from M1 onward.

### 42 · 2026-11-15 · Iman

Own AI models are postponed until at least one year of real use. Only hosted Gemini, Claude and
OpenAI, chosen by the admin. Local open models and the Private and Hybrid modes are postponed too
(Claude's reading). Replaces decisions 28, 29, 31 and 32, and narrows 30 to option A.

### 43 · 2026-11-15 · Iman

Every important Magento and Shopware problem is mapped to how AI Commerce avoids it (Notion page
12; research and mitigations by Claude).

### 44 · 2026-11-15 · Claude (product owner)

Public architecture decision records are mirrored to `docs/decisions/` in the repo from M0b.
Learned from Shopware's ADRs.

### 45 · 2026-11-15 · Claude (product owner)

Core stays free of database code. The audit sink, migrations and transactions live in
`@aicommerce/db`; core only defines hooks.

### 46 · 2026-11-16 · Claude (product owner)

Events a handler emits are delivered after commit and audit, and only if the call succeeded (spec
4.3), so a failing subscriber can never undo an action. A subscriber that must be atomic with its
action will need an outbox later.

### 47 · 2026-11-16 · Claude (product owner)

The audit log never stores values of invalid input, only key names. Valid input is redacted at any
depth, well-known secret names are always redacted, and audited input is capped at 16 KiB.

### 48 · 2026-11-16 · Claude (product owner)

Nested objects in action input must be `z.strictObject`; `register` rejects anything else, so a key
an AI model invents is never dropped silently.

### 49 · 2026-11-16 · Claude (product owner)

Validation stays before the permission check, as spec 4.2 orders it. Schemas are open source
anyway, and values are no longer stored.

### 50 · 2026-11-15 · Iman

Project website at aicommerce.iranimij.net: Hugo, a private repository, automatic deploy on every
change to `main`, built when the product is finished.

## M0b implementation rulings (2026-11-16)

### 51 · 2026-11-16 · Claude (implementer)

Pre-flight: Task 5 declares `appInfo.settings()` as a `readonly unknown[]` placeholder, typed as
`SettingDefinition` in Task 6. Cost if wrong: one type edit.

### 52 · 2026-11-16 · Claude (implementer)

Task 1: `namespaces` replaces the default `[name]` rather than adding to it; `modules/system` needs
only attribute, setting and job. Cost if wrong: a module must list its own name too.

### 53 · 2026-11-16 · Claude (implementer)

Task 1: service provisions carry their module and are owner-checked like steps and wraps,
consistent with M0a rules. Cost if wrong: none.

### 54 · 2026-11-16 · Claude (implementer)

Task 3: `createTestDb` keeps returning an owner handle and gains `connectAsApp()` instead of a role
option; tests need both roles on one schema. Cost if wrong: none.

### 55 · 2026-11-16 · Claude (implementer)

Task 3: the roles script lives in `packages/db` (`scripts/roles.mjs`) and runs with
`pnpm db:roles`; only `packages/db` can resolve `postgres` under pnpm. Cost if wrong: none.

### 56 · 2026-11-16 · Claude (implementer)

Task 3: the app role is read-only on `migrations`, so it cannot make a migration re-run. Cost if
wrong: none.

### 57 · 2026-11-16 · Claude (implementer)

Task 3: GitHub actions are pinned to the SHAs of the versions Dependabot PRs #10 to #14 proposed
(checkout v7, setup-node v7, pnpm action v6, codeql v4, changesets v2), superseding those PRs. Cost
if wrong: a major bump breaks a workflow; CI covers `ci.yml`, `release.yml` stays gated off.

### 58 · 2026-11-16 · Claude (implementer)

Task 4: the default table is `<module>_<name>` (`sample_note`), not `<name>`, so a resource named
like a core table (revision, migrations) cannot collide. Cost if wrong: none; the table is
overridable.

### 59 · 2026-11-16 · Claude (implementer)

Task 4: resource timestamps are stored to the millisecond (`timestamptz(3)`, written by the store);
a microsecond timestamp would not survive the JSON cursor and pages would repeat rows. Cost if
wrong: none.

### 60 · 2026-11-16 · Claude (implementer)

Task 4: update locks the row (`select … for update`) before writing and also guards on version. The
lock gives the revision's `before`; the guard keeps it correct without a transaction hook. Cost if
wrong: none.

### 61 · 2026-11-16 · Claude (implementer)

Task 4: `@aicommerce/db/testing` exports `createTestDb` so module integration tests reuse it. Cost
if wrong: none.

### 62 · 2026-11-16 · Claude (implementer)

Task 5: `AppInfo` gains `moduleAttributes(resource)`; resource actions need module attributes at
call time and the brief's `AppInfo` had no way to reach them. Cost if wrong: none.

### 63 · 2026-11-16 · Claude (implementer)

Task 5: `AttributeStore.delete` returns a boolean (the brief said void), because `attribute.delete`
needs `not_found`. Cost if wrong: none.

### 64 · 2026-11-16 · Claude (implementer)

Task 5: a module may add attributes only to its own resources or those of a module it depends on;
`createApp` throws otherwise. Same rule as wraps. Cost if wrong: none.

### 65 · 2026-11-16 · Claude (implementer)

Task 5: attribute values in record output stay unclassified (personal) per record. Per-attribute
privacy is stored but only applied by `toModel` in M1, when the AI reads records. Cost if wrong: an
internal or public attribute is withheld from the model until then.

### 66 · 2026-11-16 · Claude (implementer)

Task 6: `createPgSettings` takes no `definitions` option. Reads get the definition as an argument
and writes get it from the action, so the store never needs the list. Cost if wrong: none.

### 67 · 2026-11-16 · Claude (implementer)

Task 6: `createApp` provides a defaults-only `settings` reader when none is given, so sample unit
tests and tools run without a database. Cost if wrong: a server that forgets to provide the store
reads defaults; Task 9's `main.ts` provides it.

### 68 · 2026-11-16 · Claude (implementer)

Task 6: `revision.record_id` becomes text (migration 0005), because setting revisions use the key as
record id. Cost if wrong: none.

### 69 · 2026-11-16 · Claude (implementer)

Task 6: shared revision helpers move to `packages/db/src/revisions.ts`, and revisions store SQL NULL
for an absent before or after. Cost if wrong: none.

### 70 · 2026-11-16 · Claude (implementer)

Task 7: the job table stores `timeout_seconds` per job; the stuck-job sweep runs in SQL and needs
each job's timeout without the definition. Cost if wrong: a changed timeout applies to new jobs
only.

### 71 · 2026-11-16 · Claude (implementer)

Task 7: `JobQueue` also has `list()` and `retry()`; `job.list` and `job.retry` need them and the
brief gave the queue only `enqueue`. Cost if wrong: none.

### 72 · 2026-11-16 · Claude (implementer)

Task 7: a handler is also cut off in-process after `timeoutSeconds` (counts as a failure);
otherwise a hung handler blocks `runOnce` forever. Cost if wrong: the handler's work may continue
in the background; handlers must be idempotent anyway.

### 73 · 2026-11-16 · Claude (implementer)

Task 7: a job swept back after its timeout fails if it has used all attempts. Cost if wrong: none.

### 74 · 2026-11-16 · Claude (implementer) · Fix

Task 7 follow-up: PR #30 was merged while one local run of `jobs.integration.test.ts` had failed
(CI and the rerun passed). Cause: `timestamptz(3)` rounds `now()` up, so `run_at` could sit just in
the future. Fixed in `fix/job-run-at` with `date_trunc('milliseconds', now())` and a RED→GREEN test;
0 failures in 20 runs. Process fix: never chain a merge after a local test run; gate on its result.

### 75 · 2026-11-16 · Claude (implementer)

Task 8: Better Auth's rate limits use `customStorage` backed by `createRateLimiter` (the
`rate_limit` table), not a separate `admin_rate_limit` table. One mechanism, shared across
processes. Cost if wrong: none.

### 76 · 2026-11-16 · Claude (implementer)

Task 8: the TOTP issuer stays "AI Commerce". Better Auth form-encodes it in the URI query
("AI+Commerce") while the label is "AI%20Commerce"; the M0c QA gate must scan the QR code with a
real authenticator app and check the name. Cost if wrong: the app shows "AI+Commerce"; fix by
rewriting `totpURI` in an after-hook.

Checked on 2026-11-16: Iman scanned the QR code with an authenticator app, which shows "AI Commerce". No change needed.

### 77 · 2026-11-16 · Claude (implementer)

Task 8: `identity.createAdmin` writes `admin_user` and `admin_account` itself on
`database.current()` (password hashed by Better Auth's own hasher), so `admin.create` joins the
call's transaction and rolls back with it. Cost if wrong: must track Better Auth's credential
account shape on upgrades; covered by the sign-in test.

### 78 · 2026-11-16 · Claude (implementer)

Task 8: editing a role, changing an admin's roles, or disabling an admin needs every permission
involved (the role's old and new permissions, the roles added or removed, the target's
permissions). The brief only covered granting; without this a `role.manage` admin could strip or
disable an owner. Cost if wrong: none.

### 79 · 2026-11-16 · Claude (implementer)

Task 8: active owners are read with `for update`, so two concurrent demotions cannot both pass the
last-owner check. Cost if wrong: none.

### 80 · 2026-11-16 · Claude (implementer)

Task 8: rate limits use fixed 60-second windows, so up to 10 sign-in attempts can land across a
boundary. Acceptable for M0; revisit with sliding windows if abuse shows. Cost if wrong: twice the
attempts in the worst case.

### 81 · 2026-11-16 · Claude (implementer)

Task 9: `AdminAuth` gains `session(headers)` returning `{ actor, twoFactorEnabled }`, so `/api/me`
can tell "2FA not on" from "no roles". Cost if wrong: none.

### 82 · 2026-11-16 · Claude (implementer)

Task 9: `/api/auth/*` gets the client address in `x-aicommerce-client-ip`, set by the server from
the socket (or trusted proxy hops) and overwriting any client value; Better Auth reads only that
header. Otherwise a forged `X-Forwarded-For` dodges the sign-in limit. Cost if wrong: none.

### 83 · 2026-11-16 · Claude (implementer)

Task 9: a signed-in request with no `Origin` header is rejected like a foreign one. Cost if wrong:
non-browser clients using the cookie must send `Origin`; API tokens (M10) are the non-browser path.

### 84 · 2026-11-16 · Claude (implementer)

Task 9: a 2 MB input to a public action is 413 (body limit), not 400, because the server refuses it
before the action sees it; `42` and `{"__proto__": {}}` are 400. Cost if wrong: none.

### 85 · 2026-11-16 · Claude (implementer)

Task 9: shared wiring (`apps/server/src/wiring.ts`) builds the app for `main.ts` and the tests. Cost
if wrong: none.

### 86 · 2026-11-16 · Claude (implementer) · Fix

Task 9, found by the manual run: (1) `runMigrations` deadlocked with a one-connection owner pool
because `grantAppRole` used the pool while the runner held the reserved connection; `grantAppRole`
now takes the reserved connection, with a RED→GREEN test. (2) Compose ran node under sh and pnpm, so
SIGTERM never reached it (killed after 10 s); it now uses `exec node`, and the graceful stop was
checked by hand.

### 87 · 2026-11-16 · Claude (implementer)

Task 10: the guides cite runnable examples, so `modules/sample` gained an event, a job and a secret
setting, with wrap and subscriber tests. Cost if wrong: none.

### 88 · 2026-11-16 · Claude (implementer)

Task 10: the "M0b done when" list is proven by one acceptance test over HTTP
(`apps/server/src/acceptance.integration.test.ts`). Cost if wrong: none.

### 89 · 2026-11-16 · Claude (implementer)

Final review: `<resource>.restore` takes the `version` you read; a stale one is a conflict. Leave it
out only to bring back a deleted record. Cost if wrong: none yet; no caller existed.

### 90 · 2026-11-16 · Claude (implementer)

Final review: every POST to `/api/auth/*` is audited by the server as `auth.<path>` with actor,
address and outcome, never the body. Cost if wrong: a sign-in row shows the guest, not the admin.

### 91 · 2026-11-16 · Claude (implementer)

Final review: guests are rate-limited per IPv6 /64, and windows older than an hour are pruned on
about one hit in a hundred until a scheduled job exists. Cost if wrong: a few ms on 1% of requests.

### 92 · 2026-11-16 · Claude (implementer)

Final review: a job's timeout is stored at enqueue and used by both the worker's timer and the
sweep; the sweep waits 30 s more. Cost if wrong: raising a timeout affects new jobs only.

### 93 · 2026-11-16 · Claude (implementer) · Open for Iman

Sessions slide: `updateAge` 1 h keeps a session in use alive past 8 h. The spec only says "session
expiry". An absolute cap (for example 24 h) is Iman's call.

### 94 · 2026-11-16 · Iman

The logo is proposal C, "Orbit a": a lowercase a with a dot orbiting its bowl. The palette is
unchanged, since all three proposals shared it (ink #111318, paper #F4F4F1, accent #3046D9, and
#7D8CFF on dark, in Space Grotesk). The mark is `Logo` in `@aicommerce/ui`, plus SVG files for the
favicon and app icon.

### 95 · 2026-11-16 · Iman

Work may run in parallel background agents. Each works in its own git worktree and Docker project,
merges its own pull request when CI is green, and reports its rulings. Used for M0c Tasks 8, 9 and
10, the review and its fixes.

## M0c implementation rulings (2026-11-16)

Decided by Claude and its agents while building M0c. Each line says what it costs if wrong.

### 96 · 2026-11-16 · Claude (implementer) · Task 1

New dependencies are pinned exactly to a version published at least 14 days earlier (intl-messageformat 12.1.4, not 12.1.5). Cost if wrong: an older patch release is used for up to two weeks.

### 97 · 2026-11-16 · Claude (implementer) · Task 1

`Translator.t` and `has` are function properties, so `const { t } = translator` works. Cost if wrong: none.

### 98 · 2026-11-16 · Claude (implementer) · Task 1

Two catalogs with the same namespace are rejected at start-up. Cost if wrong: none.

### 99 · 2026-11-16 · Claude (implementer) · Task 2

`resolveModules(...).added[].requiredBy` is `string | null`; null marks a required module. Cost if wrong: none.

### 100 · 2026-11-16 · Claude (implementer) · Task 2

`AppInfo` gains `modules()` and `enabledModules()`. Cost if wrong: none.

### 101 · 2026-11-16 · Claude (implementer) · Task 2

`module_state` has a `position` column, so the enabled list keeps load order. Cost if wrong: none.

### 102 · 2026-11-16 · Claude (implementer) · Task 2

The module state store and the module actions are tested together in `modules/system`. Cost if wrong: none.

### 103 · 2026-11-16 · Claude (implementer) · Task 3

`createServer` and `createWorker` take `app: App | (() => App)`. Cost if wrong: none.

### 104 · 2026-11-16 · Claude (implementer) · Task 3

The contract test runs as a named step in the required `ci` job. Cost if wrong: none.

### 105 · 2026-11-16 · Claude (implementer) · Task 3

The NOTIFY payload is the schema name and listeners ignore other schemas. Cost if wrong: none.

### 106 · 2026-11-16 · Claude (implementer) · Task 3

A stored module that is no longer installed is skipped and reported, so the shop still starts. Cost if wrong: its actions answer 404 until it is installed again.

### 107 · 2026-11-16 · Claude (implementer) · Task 4

The setup tests live in `apps/server`, which has the real wiring and HTTP. Cost if wrong: none.

### 108 · 2026-11-16 · Claude (implementer) · Task 4

The server applies the setup rate limit to every `setup.*` call except `setup.status`; signed-in admins are counted per admin (changed in #52). Cost if wrong: an owner who retries a lot waits up to a minute.

### 109 · 2026-11-16 · Claude (implementer) · Task 4

A signed-in owner with 2FA may continue setup without the token. Superseded in part by #52: a token is now issued on every start until setup is finished. Cost if wrong: anyone reading the log can change shop details or modules until setup is finished; they cannot create a second owner or finish without the owner's 2FA.

### 110 · 2026-11-16 · Claude (implementer) · Task 4

`setup.status` shows the PostgreSQL version only while setup is unfinished. Cost if wrong: none.

### 111 · 2026-11-16 · Claude (implementer) · Task 4

`setup.choose-modules` stores the resolved list in `setup_state`; `setup.finish` applies it. Once chosen, `setup.status` reports the step `finish` (#57). Cost if wrong: none.

### 112 · 2026-11-16 · Claude (implementer) · Task 5

Design-system dependencies are pinned to the newest releases at least 14 days old. Cost if wrong: as Task 1.

### 113 · 2026-11-16 · Claude (implementer) · Task 5

axe's colour-contrast rule is off in jsdom; contrast is checked from the token values (4.5:1, both themes). Cost if wrong: a contrast problem made by layout, not tokens, is caught only in e2e.

### 114 · 2026-11-16 · Claude (implementer) · Task 5

Themes are set with `data-theme` on any element; the dark values are repeated under `prefers-color-scheme` and a test keeps them equal. Cost if wrong: none.

### 115 · 2026-11-16 · Claude (implementer) · Task 5

Success colour is #0b6e4c, not the logo palette's #0f8a5f (4.4:1 on white). Cost if wrong: none.

### 116 · 2026-11-16 · Claude (implementer) · Task 6

`readEnv` stays in the server; `@aicommerce/db` exports `databaseEnv` and `parseEnv` for the CLI. Cost if wrong: none.

### 117 · 2026-11-16 · Claude (implementer) · Task 6

The CLI gets the first-party module list from a `@aicommerce/server` entry. Cost if wrong: a package depends on an app.

### 118 · 2026-11-16 · Claude (implementer) · Task 6

`module enable` and `disable` run the module actions on the runtime role; the server runs new migrations when it hears the change. Cost if wrong: a shop with no server running gets the migrations at its next start.

### 119 · 2026-11-16 · Claude (implementer) · Task 6

`inspect` builds the app with every installed module on, without a database. Cost if wrong: it shows wraps of modules switched off in this shop.

### 120 · 2026-11-16 · Claude (implementer) · Task 6

`backup` and `restore` take `--schema` (for the tests); passwords go in `PGPASSWORD`, never on the command line. Cost if wrong: none.

### 121 · 2026-11-16 · Claude (implementer) · Task 6

`dev` restarts on built code and asks for `pnpm build` after a change. Cost if wrong: a slower edit loop until a watch build exists.

### 122 · 2026-11-16 · Claude (implementer) · Task 7

A third-party package's migrations are its `migrations/` folder; server and CLI share one `Install` from `loadInstall(dir)`. Cost if wrong: a package with migrations elsewhere is not migrated.

### 123 · 2026-11-16 · Claude (implementer) · Task 7

Reviewing a package imports it, which runs its top-level code; the server also imports every listed package at every start, enabled or not. Cost if wrong: a malicious package runs code with the shop's environment. Only add packages you would run.

### 124 · 2026-11-16 · Claude (implementer) · Task 7

A rejected or failed `add` runs `pnpm remove` and writes back the exact bytes of `package.json`, the lockfile and the config. Cost if wrong: none.

### 125 · 2026-11-16 · Claude (implementer) · Task 8

The admin's `/api` proxy is in `proxy.ts`, so one build reaches any server address. Cost if wrong: none.

### 126 · 2026-11-16 · Claude (implementer) · Task 8

"Choose features" uses `module.list` through the owner's session. Cost if wrong: a visitor with only the token is asked to sign in.

### 127 · 2026-11-16 · Claude (implementer) · Task 8

The admin's CSP allows inline style attributes (Radix renders one); scripts and `<style>` need the nonce. Cost if wrong: a slightly weaker CSP.

### 128 · 2026-11-16 · Claude (implementer) · Task 8

`AICOMMERCE_TRUSTED_PROXIES` stays 0 by default; behind an overwriting TLS proxy the README says to set 1. Cost if wrong: without it, every visitor behind the proxy shares one rate-limit address.

### 129 · 2026-11-16 · Claude (implementer) · Task 9

The `.env` template is stored as `templates/env`, because git and npm skip `.env` files. Cost if wrong: none.

### 130 · 2026-11-16 · Claude (implementer) · Task 9

The shop is published on 127.0.0.1 only; the README asks for a TLS proxy in front. Cost if wrong: VPS users edit one line.

### 131 · 2026-11-16 · Claude (implementer) · Task 9

A one-shot `migrate` service creates the runtime role and runs migrations before the shop starts. Cost if wrong: a slightly slower start.

### 132 · 2026-11-16 · Claude (implementer) · Task 9

`aicommerce.config.json` is written but not mounted; the stock image runs first-party modules only. Cost if wrong: third-party modules need a custom image.

### 133 · 2026-11-16 · Claude (implementer) · Task 9

No PostgreSQL client in the image; generated shops back up with the `db` container's `pg_dump` (documented in their README). Cost if wrong: `ai-commerce backup` does not run inside the shop container.

### 134 · 2026-11-16 · Claude (implementer) · Task 9

No Docker HEALTHCHECK, because the worker role has no HTTP port. Cost if wrong: orchestrators check `/healthz` themselves.

### 135 · 2026-11-16 · Claude (implementer) · Task 10

Inside the container the admin takes `PORT` and the server `PORT + 1`. Cost if wrong: `PORT=65535` fails; the server port is reachable on the Docker network.

### 136 · 2026-11-16 · Claude (implementer) · Task 10

The admin passes `/healthz` and `/readyz` to the server. Cost if wrong: none.

### 137 · 2026-11-16 · Claude (implementer) · Task 10

The image runs the admin from Next's standalone output, without its own dependencies; a pnpm override keeps Playwright out. Cost if wrong: none.

### 138 · 2026-11-16 · Claude (implementer) · Task 10

The dev admin keeps `next start` with standalone output. Cost if wrong: a future Next.js may refuse it.

### 139 · 2026-11-16 · Claude (implementer) · Task 10

E2E uses a fixed pool of 15 shops from the built image, with no Docker socket, no retries, Chromium desktop and Pixel 7. Cost if wrong: a new test needs a new shop in three places; no Firefox or WebKit coverage.

### 140 · 2026-11-16 · Claude (implementer) · Final review

`restore` empties the target schemas and loads the backup through `psql` in one transaction, killing `psql` if `pg_restore` fails; it warns when the secret key does not match. Cost if wrong: the migration role must own `public`; other roles lose their rights on it.

### 141 · 2026-11-16 · Claude (implementer) · Final review

Third-party modules may not be `required`; `add` builds the app with the new module switched on before asking. Cost if wrong: a module with failing migration SQL is still not caught.

### 142 · 2026-11-16 · Claude (implementer) · QA

The PostgreSQL version on the setup page is wrapped in Unicode isolates. The QA "bug" that led to it was a misreading: the line was laid out correctly before. Cost if wrong: none.
