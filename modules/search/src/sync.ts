import { resourceStore, type ActionContext, type ActionWrap } from '@aicommerce/core'
import { databaseService } from '@aicommerce/db'
import { category, productVariant } from '@aicommerce/module-catalog'
import { sql } from 'drizzle-orm'
import { searchEngine } from './engine.js'

type Row = Record<string, unknown>
type Next = (input: unknown) => Promise<unknown>

const PAGE = 500

// Inside the catalog's own rules (order 0), so a rule that fails after the write rolls the index
// back with it: every change runs in the call's transaction.
const on = (
  action: string,
  wrap: (input: Row, ctx: ActionContext, next: Next) => Promise<unknown>,
): ActionWrap => ({ action, module: 'search', order: 10, wrap })

const index = (ctx: ActionContext, ids: string[]) => ctx.service(searchEngine).index(ctx, ids)

/** Reindexes the products of a category and of all its descendants, a page at a time. */
async function indexTree(ctx: ActionContext, categoryId: string): Promise<void> {
  const db = ctx.service(databaseService)
  let after = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const page: Row[] = await db.current().execute(
      sql`with recursive down as (
          select id from catalog_category where id = ${categoryId}
          union
          select c.id from catalog_category c join down on c.parent_id = down.id)
        select id from catalog_product
        where category_ids ?| (select array_agg(id::text) from down) and id > ${after}::uuid
        order by id limit ${PAGE}`,
    )
    await index(
      ctx,
      page.map((r) => String(r.id)),
    )
    if (page.length < PAGE) return
    after = String(page.at(-1)?.id)
  }
}

const afterWrite = (action: string, idOf: (out: Row) => unknown) =>
  on(action, async (input, ctx, next) => {
    const out = (await next(input)) as Row
    await index(ctx, [String(idOf(out))])
    return out
  })

export const sync: ActionWrap[] = [
  ...['create', 'update', 'restore'].map((verb) => afterWrite(`product.${verb}`, (o) => o.id)),
  on('product.delete', async (input, ctx, next) => {
    const out = await next(input)
    await ctx.service(searchEngine).remove(ctx, [String(input.id)])
    return out
  }),
  ...['create', 'update', 'restore'].map((verb) =>
    afterWrite(`product-variant.${verb}`, (o) => o.productId),
  ),
  on('product-variant.delete', async (input, ctx, next) => {
    const before = await ctx.service(resourceStore).get(productVariant, String(input.id))
    const out = await next(input)
    if (before) await index(ctx, [String(before.productId)])
    return out
  }),
  // Moving or switching a category changes which category ids its products are found under.
  on('category.update', async (input, ctx, next) => {
    const before = await ctx.service(resourceStore).get(category, String(input.id))
    const out = (await next(input)) as Row
    if (
      before &&
      ((before.parentId ?? null) !== (out.parentId ?? null) || before.enabled !== out.enabled)
    ) {
      await indexTree(ctx, String(out.id))
    }
    return out
  }),
  on('category.restore', async (input, ctx, next) => {
    const out = (await next(input)) as Row
    await indexTree(ctx, String(out.id))
    return out
  }),
]
