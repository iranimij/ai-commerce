import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { settingRecordId } from '@aicommerce/core'
import {
  createDb,
  databaseEnv,
  decryptSecret,
  grantAppRole,
  parseEnv,
  parseSecretKey,
  type Database,
} from '@aicommerce/db'
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
  // The schemas the restore empties first: the one asked for, or public and those in the archive.
  const targets =
    values.schema !== undefined
      ? [values.schema]
      : [
          ...new Set([
            'public',
            ...[...listed.stdout.matchAll(/^\d+; \d+ \d+ SCHEMA - (\S+) /gm)].map(
              (m) => m[1] ?? '',
            ),
          ]),
        ]
  const odd = targets.find((t) => !SCHEMA.test(t))
  if (odd !== undefined) {
    io.err(
      `${file} holds a schema named "${odd}", which restore does not handle; nothing was changed.`,
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
  // pg_restore --clean drops only what the archive holds, so a table a newer migration made would
  // survive without its migrations row and the next migrate would fail. psql empties the schemas
  // first, then runs pg_restore's script, all in one transaction: a failed restore changes nothing.
  let unreadable = ''
  try {
    await pgTool(
      'psql',
      [
        '--no-psqlrc',
        '--quiet',
        '--output=/dev/null',
        '--single-transaction',
        '--set=ON_ERROR_STOP=1',
        '--command=set local client_min_messages = warning',
        ...targets.flatMap((t) => [
          `--command=drop schema if exists ${t} cascade`,
          `--command=create schema ${t}`,
        ]),
        '--file=-',
      ],
      env.MIGRATION_DATABASE_URL,
      (psql) => {
        const script = spawn(
          'pg_restore',
          ['--clean', '--if-exists', '--no-owner', ...schema, '--file=-', file],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        )
        script.stderr.on('data', (chunk: Buffer) => (unreadable += chunk.toString()))
        script.on('error', (error) => (unreadable ||= error.message))
        script.stdout.pipe(psql.stdin, { end: false })
        // psql commits at the end of its input, so a script cut short must never get there.
        script.on('close', (code) => {
          if (code === 0) psql.stdin.end()
          else {
            unreadable ||= `pg_restore exited with ${String(code)}`
            psql.kill()
          }
        })
        psql.stdin.on('error', () => undefined)
        psql.on('close', () => script.kill())
      },
    )
  } catch (error) {
    if (!unreadable) throw error
    io.err(`${file} could not be read to the end; nothing was changed.\n${unreadable.trim()}`)
    return 1
  }
  const owner = createDb(env.MIGRATION_DATABASE_URL, {
    max: 1,
    ...(values.schema !== undefined && { searchPath: values.schema }),
  })
  let keyMatches = true
  try {
    const appRole = new URL(env.DATABASE_URL).username
    if (appRole !== new URL(env.MIGRATION_DATABASE_URL).username) {
      await grantAppRole(owner.client, appRole)
    }
    const key = io.env.AICOMMERCE_SECRET_KEY
    if (key) keyMatches = await secretKeyMatches(owner, key)
  } finally {
    await owner.close()
  }
  io.out(`Restored ${file}. Restart the server so every process starts from the restored data.`)
  if (!keyMatches) {
    io.err(
      'Warning: AICOMMERCE_SECRET_KEY does not match this backup, so its secret settings cannot be read. Set the key that was in use when the backup was made.',
    )
  }
  return 0
}

/** Whether the key decrypts a secret setting of the restored data; true when there is none. */
async function secretKeyMatches(owner: Database, value: string): Promise<boolean> {
  const [table] = await owner.client`select to_regclass('setting') as name`
  if (!table?.name) return true
  const [row] = await owner.client`select key, channel, encrypted from setting
    where encrypted is not null limit 1`
  if (!row) return true
  try {
    const id = settingRecordId(String(row.key), (row.channel as string | null) ?? null)
    decryptSecret(String(row.encrypted), parseSecretKey(value), id)
    return true
  } catch {
    return false
  }
}
