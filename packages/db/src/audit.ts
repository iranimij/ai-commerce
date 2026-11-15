import type { AuditSink } from '@aicommerce/core'
import type { Database } from './client.js'

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/** jsonb rejects NUL characters and lone surrogates; strip and replace them. */
function storable(value: unknown): unknown {
  if (typeof value === 'string')
    return value.replaceAll('\u0000', '').replace(LONE_SURROGATE, '\uFFFD')
  if (Array.isArray(value)) return value.map(storable)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [storable(key) as string, storable(item)]),
    )
  }
  return value
}

/** Writes audit entries to the append-only `audit_log` table, outside any open transaction. */
export function createDbAuditSink(database: Database): AuditSink {
  const { client } = database
  return {
    async write(entry) {
      const insert = (input: unknown) => client`
        insert into audit_log
          (actor_type, actor_id, on_behalf_of, action, input, outcome, duration_ms)
        values (
          ${entry.actorType}, ${entry.actorId}, ${entry.onBehalfOf}, ${entry.action},
          ${JSON.stringify(input)}::jsonb, ${entry.outcome}, ${entry.durationMs}
        )`
      try {
        await insert(storable(entry.input))
      } catch {
        // Never lose the row because of what the caller sent.
        await insert('[unstorable input]')
      }
    },
  }
}
