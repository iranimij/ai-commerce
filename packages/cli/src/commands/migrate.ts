import { readdirSync } from 'node:fs'
import { createDb, databaseEnv, parseEnv, runMigrations } from '@aicommerce/db'
import { migrationSources } from '@aicommerce/server'
import { parse, table, UsageError, type Io } from '../io.js'
import { installedModules } from '../modules.js'

/** Applies the pending migrations of core and the installed modules, as the owner role. */
export async function migrate(argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(argv, { status: { type: 'boolean' } })
  if (positionals.length > 0) throw new UsageError('migrate takes no arguments')
  const env = parseEnv(databaseEnv, io.env)
  const appRole = new URL(env.DATABASE_URL).username
  const ownerRole = new URL(env.MIGRATION_DATABASE_URL).username
  const owner = createDb(env.MIGRATION_DATABASE_URL, { max: 1 })
  try {
    const sources = migrationSources(await installedModules(owner, io), io.install)
    if (values.status) {
      let applied = new Set<string>()
      try {
        const rows = await owner.client`select module, name from migrations`
        applied = new Set(rows.map((r) => `${String(r.module)}/${String(r.name)}`))
      } catch {
        // No migrations table yet: everything is pending.
      }
      const rows = sources.flatMap((s) =>
        readdirSync(s.dir)
          .filter((f) => f.endsWith('.sql'))
          .sort()
          .map((f) => ({
            module: s.module,
            migration: f,
            status: applied.has(`${s.module}/${f}`) ? 'applied' : 'pending',
          })),
      )
      for (const line of table(rows)) io.out(line)
      return 0
    }
    const done = await runMigrations(owner, sources, {
      ...(appRole !== ownerRole && { appRole }),
      log: io.out,
    })
    io.out(done.length === 0 ? 'Nothing to migrate.' : `Applied ${String(done.length)} migrations.`)
    return 0
  } finally {
    await owner.close()
  }
}
