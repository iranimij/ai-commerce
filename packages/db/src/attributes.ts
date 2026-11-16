import { ActionError, type AttributeDefinition, type AttributeStore } from '@aicommerce/core'
import { sql } from 'drizzle-orm'
import type { Database } from './client.js'

/** Merchant attribute definitions in the `attribute` table. */
export function createPgAttributeStore(database: Database): AttributeStore {
  const run = async (query: ReturnType<typeof sql>) =>
    (await database.current().execute(query)) as unknown as Record<string, unknown>[]
  return {
    async list(resource) {
      const rows = await run(
        sql`select * from attribute where resource = ${resource} order by code`,
      )
      return rows.map((row): AttributeDefinition => ({
        resource: String(row.resource),
        code: String(row.code),
        label: String(row.label),
        type: row.type as AttributeDefinition['type'],
        ...(row.options ? { options: row.options as string[] } : {}),
        required: row.required === true,
        privacy: row.privacy as AttributeDefinition['privacy'],
        source: 'merchant',
      }))
    },
    async create(def) {
      const rows = await run(sql`insert into attribute
          (resource, code, label, type, options, required, privacy)
        values (${def.resource}, ${def.code}, ${def.label}, ${def.type},
          ${def.options ? sql`${JSON.stringify(def.options)}::jsonb` : null}, ${def.required}, ${def.privacy})
        on conflict do nothing returning code`)
      if (rows.length === 0) {
        throw new ActionError('conflict', `Attribute "${def.code}" already exists`)
      }
    },
    async delete(resource, code) {
      const rows = await run(
        sql`delete from attribute where resource = ${resource} and code = ${code} returning code`,
      )
      return rows.length > 0
    },
  }
}
