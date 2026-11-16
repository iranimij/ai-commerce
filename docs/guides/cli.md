# The `ai-commerce` command (`@aicommerce/cli`)

In this repository, build once with `./dev pnpm build`, then run `./dev ai-commerce <command>`.
Exit codes: 0 for ok, 1 for an error, 2 for wrong usage (the usage text is printed).

| Command                                             | What it does                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| `dev`                                               | Migrations, then the server and worker (`node --watch`) and the admin |
| `migrate [--status]`                                | Apply pending migrations as the owner role, or list them              |
| `inspect <action\|pipeline\|event\|service> <name>` | How one piece is put together, with wraps in order; `--json` too      |
| `inspect modules`                                   | Every installed module with its label, dependencies and `required`    |
| `module list`                                       | Which modules are on                                                  |
| `module enable <name>`                              | Switch a module on, and what it needs; running servers follow         |
| `module disable <name> [--yes]`                     | Switch a module off after asking; its data is kept                    |
| `module create <name> [--dir <parent>]`             | Write a new module with one action and a passing test                 |
| `add <package> [--yes]`                             | Install an extension after reviewing what it declares                 |
| `backup [--out <file>]`                             | `pg_dump` in custom format to `backups/aicommerce-<time>.dump`        |
| `restore <file> [--yes]`                            | Replace the database with a backup, in one transaction                |

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
4. On yes, it is listed in `aicommerce.config.json` and stays switched off until you run
   `module enable`. On no, or on any error, `package.json`, the lockfile and the config are put
   back byte for byte.

Reading the declarations imports the package, which runs its top-level code. Only add packages
you would run.

## Backups

- `backup` reminds you to keep `AICOMMERCE_SECRET_KEY` with the file: without it, secret settings
  in the backup cannot be read. A backup holds personal data; store it like the database.
- `restore` refuses a file `pg_restore` cannot read, and asks before replacing anything unless
  you pass `--yes`.
- It restores with `--clean --if-exists --single-transaction`, so a failed restore changes nothing.
- It then grants the runtime role its rights again. Restart the server afterwards.
