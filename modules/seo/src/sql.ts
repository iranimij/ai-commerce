import { ActionError, type ActionContext, type Result } from '@aicommerce/core'
import { databaseService } from '@aicommerce/db'
import { sql, type SQL } from 'drizzle-orm'

export type Row = Record<string, unknown>

export const rows = async (ctx: ActionContext, query: SQL): Promise<Row[]> =>
  await ctx.service(databaseService).current().execute(query)

/** `in ${anyText(list)}`: a list of strings as one parameter. */
export const anyText = (list: readonly string[]) =>
  sql`(select jsonb_array_elements_text(${JSON.stringify(list)}::jsonb))`

export const anyUuid = (list: readonly string[]) =>
  sql`(select value::uuid from jsonb_array_elements_text(${JSON.stringify(list)}::jsonb))`

/** Joins `seo_path s` to its record; `visible` holds only for active products and enabled categories. */
export const withRecord = sql`seo_path s
  left join catalog_product p on s.kind = 'product' and p.id = s.record_id
  left join catalog_category c on s.kind = 'category' and c.id = s.record_id`
export const visible = sql`(p.status = 'active' or c.enabled)`

/** Fails a nested call's result the same way, so the whole call rolls back. */
export function must(result: Result<unknown>): unknown {
  if (result.ok) return result.output
  const { code, message, issues } = result.error
  if (
    code === 'invalid_input' ||
    code === 'not_found' ||
    code === 'conflict' ||
    code === 'forbidden'
  )
    throw new ActionError(code, message, issues)
  throw new Error(`Nested call failed: ${code}`)
}
