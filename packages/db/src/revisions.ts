import { ActionError, type Page, type Revision, type WriteMeta } from '@aicommerce/core'
import { sql, type SQL } from 'drizzle-orm'
import type { Database } from './client.js'

type Row = Record<string, unknown>

export const iso = (col: string) =>
  sql.raw(`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
const jsonOrNull = (value: unknown): SQL =>
  value === null ? sql`null` : sql`${JSON.stringify(value)}::jsonb`

const toRevision = (row: Row): Revision => ({
  id: String(row.id),
  resource: String(row.resource),
  recordId: String(row.record_id),
  version: row.version === null ? null : Number(row.version),
  action: String(row.action),
  actorType: row.actor_type as Revision['actorType'],
  actorId: (row.actor_id ?? null) as string | null,
  onBehalfOf: (row.on_behalf_of ?? null) as string | null,
  at: String(row.__at),
  before: (row.before ?? null) as Revision['before'],
  after: (row.after ?? null) as Revision['after'],
})

/** Revisions of resources and settings, in the append-only `revision` table. */
export function createRevisions(database: Database) {
  const run = async (query: SQL): Promise<Row[]> => await database.current().execute(query)
  return {
    async record(change: {
      resource: string
      recordId: string
      version: number | null
      meta: WriteMeta
      before: Record<string, unknown> | null
      after: Record<string, unknown> | null
    }): Promise<void> {
      const { resource, recordId, version, meta, before, after } = change
      await run(sql`insert into revision
        (resource, record_id, version, action, actor_type, actor_id, on_behalf_of, before, after)
        values (${resource}, ${recordId}, ${version}, ${meta.action}, ${meta.actor.type},
          ${meta.actor.id}, ${meta.actor.onBehalfOf ?? null}, ${jsonOrNull(before)}, ${jsonOrNull(after)})`)
    },

    /** Newest first; the cursor is the id of the last revision of the previous page. */
    async page(
      resource: string,
      recordId: string,
      cursor: string | undefined,
      limit: number,
    ): Promise<Page<Revision>> {
      if (cursor !== undefined && !/^\d{1,19}$/.test(cursor)) {
        throw new ActionError('invalid_input', 'Invalid cursor')
      }
      const rows = await run(sql`select *, ${iso('at')} as "__at" from revision
        where resource = ${resource} and record_id = ${recordId}
        ${cursor === undefined ? sql`` : sql`and id < ${cursor}`}
        order by id desc limit ${limit + 1}`)
      const items = rows.slice(0, limit).map(toRevision)
      return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null }
    },

    async get(resource: string, revisionId: string): Promise<Revision | null> {
      const [row] = await run(sql`select *, ${iso('at')} as "__at" from revision
        where id = ${revisionId} and resource = ${resource}`)
      return row ? toRevision(row) : null
    },
  }
}
