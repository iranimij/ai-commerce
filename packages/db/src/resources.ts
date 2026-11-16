import {
  ActionError,
  type ResourceDefinition,
  type ResourceRecord,
  type ResourceStore,
  type Revision,
  type WriteMeta,
} from '@aicommerce/core'
import { sql, type SQL } from 'drizzle-orm'
import type { Database } from './client.js'

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

const ident = (name: string): SQL => {
  if (!IDENTIFIER.test(name)) throw new Error(`Invalid identifier "${name}"`)
  return sql`${sql.identifier(name)}`
}
const column = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
// Milliseconds, so a timestamp survives the round trip through a JSON cursor unchanged.
const NOW = sql.raw(`date_trunc('milliseconds', now())`)
const iso = (col: string) =>
  sql.raw(`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`

type Row = Record<string, unknown>

// Given keys replace their values; a null value removes the key.
function patchAttributes(patch: Record<string, unknown>): SQL {
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null))
  const removed = Object.keys(patch).filter((k) => patch[k] === null)
  return sql.join(
    [sql`(attributes || ${json(set)})`, ...removed.map((k) => sql`${k}::text`)],
    sql` - `,
  )
}

function encodeCursor(value: unknown[]): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      !Number.isNaN(Date.parse(value[0])) &&
      typeof value[1] === 'string' &&
      /^[0-9a-f-]{36}$/.test(value[1])
    ) {
      return [value[0], value[1]]
    }
  } catch {
    // Falls through to the error below.
  }
  throw new ActionError('invalid_input', 'Invalid cursor')
}

/** Resources in PostgreSQL. Every query runs on the call's transaction when there is one. */
export function createPgResourceStore(database: Database): ResourceStore {
  const run = async (query: SQL): Promise<Row[]> => await database.current().execute(query)

  const fieldsOf = (r: ResourceDefinition) =>
    Object.keys(r.fields.shape).map((field) => ({ field, col: column(field) }))

  const select = (r: ResourceDefinition) =>
    sql`select *, ${iso('created_at')} as "__created", ${iso('updated_at')} as "__updated" from ${ident(r.table)}`

  const toRecord = (r: ResourceDefinition, row: Row): ResourceRecord => {
    const record: ResourceRecord = {
      id: String(row.id),
      version: Number(row.version),
      createdAt: String(row.__created),
      updatedAt: String(row.__updated),
      attributes: (row.attributes ?? {}) as Record<string, unknown>,
    }
    for (const { field, col } of fieldsOf(r)) {
      if (row[col] !== null && row[col] !== undefined) record[field] = row[col]
    }
    return record
  }

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
    before: (row.before ?? null) as ResourceRecord | null,
    after: (row.after ?? null) as ResourceRecord | null,
  })

  const writeRevision = (
    r: ResourceDefinition,
    recordId: string,
    version: number | null,
    meta: WriteMeta,
    before: ResourceRecord | null,
    after: ResourceRecord | null,
  ) =>
    run(sql`insert into revision
      (resource, record_id, version, action, actor_type, actor_id, on_behalf_of, before, after)
      values (${r.name}, ${recordId}, ${version}, ${meta.action}, ${meta.actor.type},
        ${meta.actor.id}, ${meta.actor.onBehalfOf ?? null}, ${json(before)}, ${json(after)})`)

  const getRow = async (r: ResourceDefinition, id: string, lock = false) => {
    const rows = await run(sql`${select(r)} where id = ${id}${lock ? sql` for update` : sql``}`)
    return rows[0]
  }

  // Locks the row at the expected version, or says why it cannot.
  const lockVersion = async (r: ResourceDefinition, id: string, expected: number) => {
    const row = await getRow(r, id, true)
    if (!row) throw new ActionError('not_found', `${r.label.singular} not found`)
    if (Number(row.version) !== expected) {
      throw new ActionError(
        'conflict',
        `Record changed since version ${String(expected)}; reload and try again`,
      )
    }
    return toRecord(r, row)
  }

  const assignments = (r: ResourceDefinition, values: Record<string, unknown>) =>
    fieldsOf(r)
      .filter(({ field }) => field in values)
      .map(({ field, col }) => sql`${ident(col)} = ${values[field] ?? null}`)

  const insert = async (
    r: ResourceDefinition,
    id: string | null,
    version: number,
    values: Record<string, unknown>,
    attributes: Record<string, unknown>,
    createdAt: string | null,
  ) => {
    const present = fieldsOf(r).filter(({ field }) => values[field] !== undefined)
    const cols = [
      ...['id', 'version', 'created_at', 'updated_at', 'attributes'].map(ident),
      ...present.map(({ col }) => ident(col)),
    ]
    const vals = [
      id === null ? sql`gen_random_uuid()` : sql`${id}`,
      sql`${version}`,
      createdAt === null ? NOW : sql`${createdAt}::timestamptz`,
      NOW,
      json(attributes),
      ...present.map(({ field }) => sql`${values[field]}`),
    ]
    const [row] = await run(sql`with inserted as (
        insert into ${ident(r.table)} (${sql.join(cols, sql`, `)})
        values (${sql.join(vals, sql`, `)}) returning *)
      select *, ${iso('created_at')} as "__created", ${iso('updated_at')} as "__updated" from inserted`)
    return toRecord(r, row ?? {})
  }

  const store: ResourceStore = {
    async list(r, { filter, attributes, cursor, limit }) {
      const where: SQL[] = []
      for (const [field, value] of Object.entries(filter ?? {})) {
        if (value !== undefined) where.push(sql`${ident(column(field))} = ${value}`)
      }
      if (attributes && Object.keys(attributes).length > 0) {
        where.push(sql`attributes @> ${json(attributes)}`)
      }
      if (cursor) {
        const [at, id] = decodeCursor(cursor)
        where.push(sql`(created_at, id) > (${at}::timestamptz, ${id}::uuid)`)
      }
      const rows = await run(sql`${select(r)}
        ${where.length > 0 ? sql`where ${sql.join(where, sql` and `)}` : sql``}
        order by created_at, id limit ${limit + 1}`)
      const items = rows.slice(0, limit).map((row) => toRecord(r, row))
      const last = items.at(-1)
      return {
        items,
        nextCursor: rows.length > limit && last ? encodeCursor([last.createdAt, last.id]) : null,
      }
    },

    async get(r, id) {
      const row = await getRow(r, id)
      return row ? toRecord(r, row) : null
    },

    async create(r, values, attributes, meta) {
      const record = await insert(r, null, 1, values, attributes, null)
      await writeRevision(r, record.id, 1, meta, null, record)
      return record
    },

    async update(r, id, expected, values, attributes, meta) {
      const before = await lockVersion(r, id, expected)
      const set = [
        sql`version = version + 1`,
        sql`updated_at = ${NOW}`,
        ...(attributes === undefined ? [] : [sql`attributes = ${patchAttributes(attributes)}`]),
        ...assignments(r, values),
      ]
      const [row] = await run(sql`with updated as (
          update ${ident(r.table)} set ${sql.join(set, sql`, `)}
          where id = ${id} and version = ${expected} returning *)
        select *, ${iso('created_at')} as "__created", ${iso('updated_at')} as "__updated" from updated`)
      if (!row) {
        throw new ActionError(
          'conflict',
          `Record changed since version ${String(expected)}; reload and try again`,
        )
      }
      const after = toRecord(r, row)
      await writeRevision(r, id, after.version, meta, before, after)
      return after
    },

    async delete(r, id, expected, meta) {
      const before = await lockVersion(r, id, expected)
      await run(sql`delete from ${ident(r.table)} where id = ${id} and version = ${expected}`)
      await writeRevision(r, id, null, meta, before, null)
    },

    async history(r, id, cursor, limit) {
      if (cursor !== undefined && !/^\d{1,19}$/.test(cursor)) {
        throw new ActionError('invalid_input', 'Invalid cursor')
      }
      const rows = await run(sql`select *, ${iso('at')} as "__at" from revision
        where resource = ${r.name} and record_id = ${id}
        ${cursor === undefined ? sql`` : sql`and id < ${cursor}`}
        order by id desc limit ${limit + 1}`)
      const items = rows.slice(0, limit).map(toRevision)
      return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null }
    },

    async revision(r, revisionId) {
      const [row] = await run(sql`select *, ${iso('at')} as "__at" from revision
        where id = ${revisionId} and resource = ${r.name}`)
      return row ? toRevision(row) : null
    },

    async restore(r, revision, meta) {
      const snapshot = revision.after ?? revision.before
      if (!snapshot) throw new ActionError('not_found', 'Revision has no record')
      const values: Record<string, unknown> = {}
      for (const { field } of fieldsOf(r)) {
        if (snapshot[field] !== undefined) values[field] = snapshot[field]
      }
      const checked = r.fields.safeParse(values)
      if (!checked.success) {
        throw new ActionError(
          'invalid_input',
          "This revision no longer matches the resource's fields",
          checked.error.issues,
        )
      }
      const fields = checked.data
      const current = await getRow(r, revision.recordId, true)
      let after: ResourceRecord
      if (current) {
        const before = toRecord(r, current)
        // Every field is written, so one absent from the snapshot becomes empty again.
        const all = Object.fromEntries(fieldsOf(r).map(({ field }) => [field, fields[field]]))
        const set = [
          sql`version = version + 1`,
          sql`updated_at = ${NOW}`,
          sql`attributes = ${json(snapshot.attributes)}`,
          ...assignments(r, all),
        ]
        const [row] = await run(sql`with updated as (
            update ${ident(r.table)} set ${sql.join(set, sql`, `)}
            where id = ${revision.recordId} returning *)
          select *, ${iso('created_at')} as "__created", ${iso('updated_at')} as "__updated" from updated`)
        after = toRecord(r, row ?? {})
        await writeRevision(r, after.id, after.version, meta, before, after)
      } else {
        const [last] = await run(sql`select coalesce(max(version), 0) as v from revision
          where resource = ${r.name} and record_id = ${revision.recordId}`)
        after = await insert(
          r,
          revision.recordId,
          Number(last?.v) + 1,
          fields,
          snapshot.attributes,
          snapshot.createdAt,
        )
        await writeRevision(r, after.id, after.version, meta, null, after)
      }
      return after
    },
  }
  return store
}
