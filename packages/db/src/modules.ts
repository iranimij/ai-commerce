import type { ModuleStateStore } from '@aicommerce/core'
import { sql } from 'drizzle-orm'
import type { Database } from './client.js'
import { createRevisions } from './revisions.js'

/** Every app process listens here and reloads its modules. */
export const MODULES_CHANNEL = 'aicommerce_modules'

const NOW = sql.raw(`date_trunc('milliseconds', now())`)

export function createPgModuleState(database: Database): ModuleStateStore {
  const run = async (query: ReturnType<typeof sql>) =>
    (await database.current().execute(query)) as unknown as Record<string, unknown>[]
  const revisions = createRevisions(database)

  const read = async (): Promise<string[] | null> => {
    const rows = await run(sql`select name, enabled from module_state order by position, name`)
    if (rows.length === 0) return null
    return rows.filter((r) => r.enabled === true).map((r) => String(r.name))
  }

  return {
    enabled: read,
    async set(enabled, meta) {
      const before = await read()
      await run(sql`update module_state set enabled = false, changed_at = ${NOW}
        where enabled and not (name = any(array[${sql.join(
          enabled.map((n) => sql`${n}`),
          sql`, `,
        )}]::text[]))`)
      for (const [position, name] of enabled.entries()) {
        await run(sql`insert into module_state (name, enabled, position, changed_at)
          values (${name}, true, ${position}, ${NOW})
          on conflict (name) do update set enabled = true, position = excluded.position,
            changed_at = case when module_state.enabled then module_state.changed_at
              else excluded.changed_at end`)
      }
      await revisions.record({
        resource: 'module',
        recordId: 'state',
        version: null,
        meta,
        before: before === null ? null : { enabled: before },
        after: { enabled: [...enabled] },
      })
      // Delivered by PostgreSQL only when the transaction commits.
      await run(sql`select pg_notify(${MODULES_CHANNEL}, '')`)
    },
  }
}
