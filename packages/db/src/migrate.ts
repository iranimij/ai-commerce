import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Database } from './client.js'

export interface MigrationSource {
  module: string
  /** Directory of `.sql` files, applied in file-name order. */
  dir: string
}

/** The core tables, such as the audit log. */
export const coreMigrations: MigrationSource = {
  module: 'core',
  dir: fileURLToPath(new URL('../migrations/core', import.meta.url)),
}

// Any constant works; it only has to be the same for every process migrating this database.
const MIGRATION_LOCK = 7_207_101

/**
 * Applies each migration once, each in its own transaction, and returns the ones applied as
 * "module/file". Safe to run from several processes at once.
 */
export async function runMigrations(
  database: Database,
  sources: readonly MigrationSource[],
): Promise<string[]> {
  const connection = await database.client.reserve()
  try {
    await connection`select pg_advisory_lock(${MIGRATION_LOCK})`
    await connection`
      create table if not exists migrations (
        module text not null,
        name text not null,
        applied_at timestamptz not null default now(),
        primary key (module, name)
      )`

    const applied: string[] = []
    for (const source of sources) {
      const done = new Set(
        (await connection`select name from migrations where module = ${source.module}`).map((row) =>
          String(row.name),
        ),
      )
      const files = (await readdir(source.dir)).filter((f) => f.endsWith('.sql')).sort()
      for (const file of files.filter((f) => !done.has(f))) {
        const sql = await readFile(join(source.dir, file), 'utf8')
        try {
          await connection.unsafe('begin')
          await connection.unsafe(sql)
          await connection`insert into migrations (module, name) values (${source.module}, ${file})`
          await connection.unsafe('commit')
        } catch (error) {
          await connection.unsafe('rollback')
          throw new Error(`Migration ${source.module}/${file} failed`, { cause: error })
        }
        applied.push(`${source.module}/${file}`)
      }
    }
    return applied
  } finally {
    await connection`select pg_advisory_unlock(${MIGRATION_LOCK})`
    connection.release()
  }
}
