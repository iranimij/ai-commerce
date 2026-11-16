import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Database } from './client.js'
import { grantAppRole } from './roles.js'

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
export const MIGRATION_LOCK = 7_207_101

export interface MigrateOptions {
  /** Runtime role to grant access to once migrations are applied. */
  appRole?: string
  /** Progress messages. Default: console.info. */
  log?: (message: string) => void
}

// Line endings normalised, so a checkout on Windows does not look like an edit.
const checksum = (sql: string) =>
  createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex')

/**
 * Applies each migration once, each in its own transaction, and returns the ones applied as
 * "module/file". Safe to run from several processes at once. A migration edited after it was
 * applied is an error: write a new one instead.
 */
export async function runMigrations(
  database: Database,
  sources: readonly MigrationSource[],
  options: MigrateOptions = {},
): Promise<string[]> {
  const log =
    options.log ??
    ((message: string) => {
      console.info(message)
    })
  const connection = await database.client.reserve()
  try {
    const [free] = await connection`select pg_try_advisory_lock(${MIGRATION_LOCK}) as ok`
    if (free?.ok !== true) {
      log('Waiting for another process to finish migrations')
      await connection`select pg_advisory_lock(${MIGRATION_LOCK})`
    }
    await connection`
      create table if not exists migrations (
        module text not null,
        name text not null,
        applied_at timestamptz not null default now(),
        primary key (module, name)
      )`
    await connection`alter table migrations add column if not exists checksum text`

    const applied: string[] = []
    for (const source of sources) {
      const done = new Map(
        (
          await connection`select name, checksum from migrations where module = ${source.module}`
        ).map((row) => [String(row.name), row.checksum as string | null]),
      )
      const files = (await readdir(source.dir)).filter((f) => f.endsWith('.sql')).sort()
      for (const file of files) {
        const sql = await readFile(join(source.dir, file), 'utf8')
        const sum = checksum(sql)
        if (done.has(file)) {
          const recorded = done.get(file)
          if (recorded === null || recorded === undefined) {
            await connection`update migrations set checksum = ${sum}
              where module = ${source.module} and name = ${file}`
          } else if (recorded !== sum) {
            throw new Error(`Migration ${source.module}/${file} was changed after it was applied`)
          }
          continue
        }
        try {
          await connection.unsafe('begin')
          await connection.unsafe(sql)
          await connection`insert into migrations (module, name, checksum)
            values (${source.module}, ${file}, ${sum})`
          await connection.unsafe('commit')
        } catch (error) {
          // If the connection is gone, rollback fails too; report the migration, not that.
          await connection.unsafe('rollback').catch(() => undefined)
          throw new Error(`Migration ${source.module}/${file} failed`, { cause: error })
        }
        applied.push(`${source.module}/${file}`)
      }
    }
    if (options.appRole) await grantAppRole(connection, options.appRole)
    if (applied.length > 0) log(`Applied ${String(applied.length)} migration(s)`)
    return applied
  } finally {
    try {
      await connection`select pg_advisory_unlock(${MIGRATION_LOCK})`
    } catch {
      // A lost connection has released the lock already.
    } finally {
      connection.release()
    }
  }
}
