# Resources and revisions

A resource is a kind of record. One definition gives seven actions, optimistic versions and a full
history with restore.

Example: `note` in [`modules/sample/src/index.ts`](../../modules/sample/src/index.ts), its table in
[`modules/sample/migrations/0001_note.sql`](../../modules/sample/migrations/0001_note.sql), and
[`modules/sample/src/note.integration.test.ts`](../../modules/sample/src/note.integration.test.ts).

| Action           | Risk        | Permission (default) |
| ---------------- | ----------- | -------------------- |
| `<name>.list`    | read        | `<name>.read`        |
| `<name>.get`     | read        | `<name>.read`        |
| `<name>.create`  | write       | `<name>.write`       |
| `<name>.update`  | write       | `<name>.write`       |
| `<name>.delete`  | destructive | `<name>.delete`      |
| `<name>.history` | read        | `<name>.read`        |
| `<name>.restore` | write       | `<name>.write`       |

## Rules that bite

- `update` and `delete` take the `version` you read. If the record changed since, the result is
  `conflict`: reload and try again. Of two concurrent updates from one version, exactly one wins.
- `update` changes only the fields it is given. A structured field (a `z.array`, `z.strictObject` or
  `z.record`, after `.optional()` and `.default()`) is stored in a `jsonb` column and replaced as a
  whole: send the full array or object, not the part that changed. Objects inside it must be
  `z.strictObject` too.
- A unique column gives `conflict` on create, update and restore. Name the constraint
  `<table>_<column>_key` (what `unique` on a column gives you) and the message names the field:
  "Product with this sku already exists". The violation aborts the call's transaction, so a wrap
  cannot catch it and try another value: check first.
- Every write records a revision (before and after) in the same transaction. Revisions cannot be
  changed or deleted, not even by the app's database role.
- `restore` writes a revision's snapshot as a new version. Send the `version` you read, as for
  `update`; leave it out to bring back a deleted record, which keeps its id.
- `list` pages by an opaque cursor and filters by equality on scalar fields; structured fields
  are not filters.
- The table is `<module>_<name>` by default. Write its migration yourself: `id uuid`,
  `version int`, `created_at`/`updated_at timestamptz(3)`, `attributes jsonb`, then the fields in
  snake_case (`jsonb` for structured ones). Use `.optional()`, not `.nullable()`, for fields that may be empty.
- `read: null` makes list, get and history public; review it like any public action.
