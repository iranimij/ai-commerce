# The `ai-commerce` command (`@aicommerce/cli`)

In this repository, build once with `./dev pnpm build`, then run `./dev ai-commerce <command>`.
Exit codes: 0 for ok, 1 for an error, 2 for wrong usage (the usage text is printed).

| Command                                             | What it does                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `dev`                                               | Migrations, then the server and worker (`node --watch`) and the admin   |
| `migrate [--status]`                                | Apply pending migrations as the owner role, or list them                |
| `inspect <action\|pipeline\|event\|service> <name>` | How one piece is put together, with wraps in order; `--json` too        |
| `inspect modules`                                   | Every installed module with its label, dependencies and `required`      |
| `module list`                                       | Which modules are on                                                    |
| `module enable <name>`                              | Switch a module on, and what it needs; running servers follow           |
| `module disable <name> [--yes]`                     | Switch a module off after asking; its data is kept                      |
| `module create <name> [--dir <parent>]`             | Write a new module with one action and a passing test                   |
| `add <package> [--yes]`                             | Install an extension after reviewing what it declares                   |
| `backup [--out <file>]`                             | `pg_dump` in custom format to `backups/aicommerce-<time>.dump`          |
| `restore <file> [--yes]`                            | Replace the database with a backup, in one transaction                  |
| `seed catalog --products <n>`                       | Write a large test catalog with `COPY`; needs `AICOMMERCE_ALLOW_SEED=1` |
| `bench search`                                      | Time five search shapes, 200 calls each, and print p50 and p95          |

The commands read `DATABASE_URL` and `MIGRATION_DATABASE_URL`, with the same checks as the server,
and `AICOMMERCE_MODULES` for a shop that has never stored its module state.

## Start a module

```sh
./dev ai-commerce module create gift-wrap
```

This writes `modules/gift-wrap/`:

- `package.json`, `tsconfig.json` and a vitest config;
- `src/index.ts` with `defineModule` and one action, `gift-wrap.hello`;
- `src/index.test.ts`, which passes as generated;
- a README.

From there, follow [actions](actions.md) and [modules and wraps](modules-and-wraps.md). The
sample module ([`modules/sample`](../../modules/sample/src/index.ts)) shows every contract.

## Add an extension

```sh
ai-commerce add aicommerce-module-gifts
```

1. The package is installed with `pnpm add --ignore-scripts`, so its install scripts never run.
2. Its default export must be a module.
3. You see what it declares:
   - the modules it needs;
   - every action, with its permission and risk, and the public ones called out;
   - its settings, with secrets marked;
   - its jobs and the actions it wraps;
   - the services it replaces;
   - its migrations (the package's `migrations/` folder).
4. It is refused if it declares `required`: only first-party modules can be always on.
5. Before you are asked, the app is built once with every installed module and this one switched
   on, as `inspect` does. A module the app cannot be built with is refused with the error, so it
   can never stop the server or the CLI (`module disable` included).
6. On yes, it is listed in `aicommerce.config.json` and stays switched off until you run
   `module enable`. On no, or on any error, `package.json`, the lockfile and the config are put
   back byte for byte.

Reading the declarations imports the package, which runs its top-level code. Only add packages
you would run.

## Backups

- `backup` reminds you to keep `AICOMMERCE_SECRET_KEY` with the file: without it, secret settings
  in the backup cannot be read. A backup holds personal data; store it like the database.
- `restore` refuses a file `pg_restore` cannot read, and asks before replacing anything unless
  you pass `--yes`.
- It drops and recreates the schemas first (`public` and every schema in the backup, or the one
  `--schema` names), then loads the backup with `psql`, all in one transaction. Tables made after
  the backup, by a newer migration or a module enabled since, are gone with it, so the next start
  migrates cleanly; a failed restore changes nothing. The migration role must own those schemas.
- It then grants the runtime role its rights again. Other roles' rights on the schemas are not
  kept. Restart the server afterwards.
- When `AICOMMERCE_SECRET_KEY` is set, it tries the key on one secret setting of the restored data
  and warns if the key does not match the backup (the restore still succeeds).

## Seed and benchmark (development only)

```sh
./dev sh -c 'AICOMMERCE_MODULES=system,access,search node packages/cli/dist/bin.js migrate'
./dev ai-commerce module enable search   # bench builds the app from the stored module state
./dev env AICOMMERCE_ALLOW_SEED=1 node packages/cli/dist/bin.js seed catalog --products 1000000
./dev ai-commerce bench search
```

- `seed catalog` writes `n` products (every tenth configurable, with 4 variants), 200 categories
  in two levels (products sit in the 180 lower ones), the 5 public select attributes `brand`,
  `color` (with swatches), `material`, `pattern` and `size`, every SKU and every product's
  `search_document`, with `COPY` in transactions of 10,000 products, printing progress. One
  product in 20 is a draft; prices are in EUR. The same `n` always gives the same names and
  values (the ids differ).
- It goes past every action, rule, revision and audit entry, so it refuses to run unless
  `AICOMMERCE_ALLOW_SEED=1`, and refuses a database whose catalog already has products or one of
  those attributes. It needs the `search` module's tables: switch search on and migrate first.
- Search documents are built in SQL with the engine's own expressions, using the shop language's
  text search configuration. An integration test checks that `search.reindex` rewrites them
  unchanged.
- `bench search` runs, as a visitor through `app.registry.call`, 200 calls of each shape: a
  keyword; a keyword with two filters; a top-level category sorted by price; page 5 of a
  top-level category by cursor; and `search.suggest` (half prefixes, half typos). It prints p50
  and p95 per shape against the budgets of spec 5.7 (p95 under 300 ms for `search.query`, under
  100 ms for `suggest`). Results: [`docs/benchmarks/m1a.md`](../benchmarks/m1a.md).
