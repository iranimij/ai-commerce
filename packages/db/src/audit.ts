import type { AuditSink } from '@aicommerce/core'
import type { Database } from './client.js'

/** Writes audit entries to the append-only `audit_log` table, outside any open transaction. */
export function createDbAuditSink(database: Database): AuditSink {
  const { client } = database
  return {
    async write(entry) {
      await client`
        insert into audit_log
          (actor_type, actor_id, on_behalf_of, action, input, outcome, duration_ms)
        values (
          ${entry.actorType}, ${entry.actorId}, ${entry.onBehalfOf}, ${entry.action},
          ${JSON.stringify(entry.input)}::jsonb, ${entry.outcome}, ${entry.durationMs}
        )`
    },
  }
}
