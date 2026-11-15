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
- Logo: three proposals are waiting for Iman's choice at
  https://claude.ai/artifact/DxTRuJwEqrEExvfWaD6aZF. I recommend A, Spark bag.

## Next

1. Write the M0b plan: resources, attributes, settings, privacy classes, revisions, auth,
   server. Then build it.
2. Write and build M0c: CLI, design system, installer, QA gate.
3. Move on to M1 and beyond.

## Rules for code written on top of M0a

- A nested object in an action's input must be `z.strictObject`; `register` rejects anything
  else.
- Handlers must await everything. `db.current()` is only valid during the call.
- Events emitted in a handler reach subscribers after commit, and only if the call succeeded.
- Read actions do not run in a transaction and must not write.
- Run migrations over a direct PostgreSQL connection, never through PgBouncer in transaction
  mode.

## Deferred minors from the M0a review (pick up where they fit)

- Use a runtime database role with INSERT and SELECT only on `audit_log`; the table owner can
  disable its triggers. Do this with auth and deploy in M0b.
- `guestActor` and `systemActor` permission Sets can be changed at run time; freeze `ctx`; allow
  a wrap to call `next` only once.
- A wrap should only target actions of modules it depends on. An action name should be tied to
  the module that declares it.
- Migrations: add a checksum, and log while waiting for the migration lock.
- CI:
  - Do not cancel runs on `main`.
  - Pin actions by SHA, `release.yml` first.
  - Move `pnpm audit` out of the required check.
  - Pin the Mailpit image and bind it to 127.0.0.1.

## Standing rules

- Docker only. Use Iman's Chrome for manual QA.
- One pull request per section; merge it without asking once CI is green; never merge red.
- No Claude or Anthropic attribution in commits or pull requests.
- Unit, integration and end-to-end tests for everything; manual QA gate per milestone.
- Update Notion (build log, roadmap, decisions, parity map) and this file at the end of every
  session.
- English everywhere.

## Open items

- Register the `@aicommerce` npm scope.
- Gemini API key (M1): create it in the browser and store it in a git-ignored `.env`.
- Shopify development store for M3 testing: Iman provides it.
- Logo choice: Iman.
- Dependabot PRs #9 to #15 are left for Iman. #9 (Node 26 image) and #15 (`@types/node` 26)
  conflict with the Node 24 pin; #10 to #14 bump action versions and pass CI.
- Project website at aicommerce.iranimij.net: built in M12, when the product is finished (design
  M12). DNS is in place. Iman will provide the deploy secrets and do the one-time server setup.
- Own models and local models are postponed (decision 42): hosted Gemini, Claude and OpenAI only.
  Reconsider no sooner than one year after AI Commerce is in real use.
