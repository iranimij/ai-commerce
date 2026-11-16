import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createDb, databaseEnv, grantAppRole, parseEnv } from '@aicommerce/db'
import { parse, pgTool, UsageError, type Io } from '../io.js'

const SCHEMA = /^[a-z_][a-z0-9_]*$/

// --schema limits a backup or restore to one schema; the tests use it, a shop uses the default.
function schemaArgs(schema: string | undefined): string[] {
  if (schema === undefined) return []
  if (!SCHEMA.test(schema)) throw new UsageError(`Invalid schema name "${schema}"`)
  return [`--schema=${schema}`]
}

/** A pg_dump in custom format, as the owner role. */
export async function backup(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(argv, {
    out: { type: 'string' },
    schema: { type: 'string' },
  })
  if (positionals.length > 0) throw new UsageError('backup takes no arguments; use --out <file>')
  const env = parseEnv(databaseEnv, io.env)
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const file = resolve(io.cwd, values.out ?? join('backups', `aicommerce-${stamp}.dump`))
  mkdirSync(dirname(file), { recursive: true })
  await pgTool(
    'pg_dump',
    ['--format=custom', `--file=${file}`, ...schemaArgs(values.schema)],
    env.MIGRATION_DATABASE_URL,
  )
  io.out(`Backup written to ${file}`)
  io.out('Keep AICOMMERCE_SECRET_KEY with this backup: without it, secret settings cannot be read.')
  return 0
}

/** Replaces the database with a backup, in one transaction, then grants the runtime role again. */
export async function restore(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(argv, {
    yes: { type: 'boolean' },
    schema: { type: 'string' },
  })
  const [given, extra] = positionals
  if (given === undefined || extra !== undefined)
    throw new UsageError('restore takes one backup file')
  const env = parseEnv(databaseEnv, io.env)
  const file = resolve(io.cwd, given)
  const schema = schemaArgs(values.schema)
  if (!existsSync(file)) {
    io.err(`${file} does not exist; nothing was changed.`)
    return 1
  }
  const listed = spawnSync('pg_restore', ['--list', file], { encoding: 'utf8' })
  if (listed.error) {
    throw new Error('pg_restore is not installed: install the PostgreSQL 17 client tools', {
      cause: listed.error,
    })
  }
  if (listed.status !== 0) {
    io.err(
      `${file} is not a backup made by ai-commerce backup (pg_restore cannot read it); nothing was changed.`,
    )
    return 1
  }
  if (
    !values.yes &&
    !(await io.ask(`Restore ${file}? This replaces the current data in the database.`))
  ) {
    io.err('Cancelled; nothing was changed.')
    return 1
  }
  await pgTool(
    'pg_restore',
    ['--clean', '--if-exists', '--single-transaction', '--no-owner', ...schema, file],
    env.MIGRATION_DATABASE_URL,
  )
  const appRole = new URL(env.DATABASE_URL).username
  if (appRole !== new URL(env.MIGRATION_DATABASE_URL).username) {
    const owner = createDb(env.MIGRATION_DATABASE_URL, {
      max: 1,
      ...(values.schema !== undefined && { searchPath: values.schema }),
    })
    try {
      await grantAppRole(owner.client, appRole)
    } finally {
      await owner.close()
    }
  }
  io.out(`Restored ${file}. Restart the server so every process starts from the restored data.`)
  return 0
}
