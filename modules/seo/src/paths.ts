import {
  ActionError,
  classify,
  defineAction,
  defineJob,
  jobs,
  type ActionContext,
  type ActionWrap,
} from '@aicommerce/core'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { unredirect } from './redirects.js'
import { anyText, anyUuid, must, rows, visible, withRecord, type Row } from './sql.js'

const pub = <S extends z.ZodType>(schema: S) => classify(schema, 'public')

/** First path segments the shop's own pages use; no product or category may take them. */
export const RESERVED = [
  'api',
  'admin',
  'search',
  'cart',
  'checkout',
  'account',
  'media',
  '_next',
  'sitemap.xml',
  'robots.txt',
]

type Kind = 'product' | 'category'

/** The record's path and whether it is visible; for a category, its whole subtree too. */
async function wanted(ctx: ActionContext, kind: Kind, id: string): Promise<Row[]> {
  if (kind === 'product') {
    return rows(
      ctx,
      sql`select id, '/' || slug as path, status = 'active' as visible
        from catalog_product where id = ${id}`,
    )
  }
  // Visible when it and every ancestor up to the top are enabled.
  return rows(
    ctx,
    sql`with recursive up as (
        select id, parent_id, slug, enabled, 0 as depth from catalog_category where id = ${id}
        union all
        select p.id, p.parent_id, p.slug, p.enabled, up.depth + 1
        from catalog_category p join up on p.id = up.parent_id where up.depth < 50
      ), head as (
        select '/' || string_agg(slug, '/' order by depth desc) as path,
          bool_and(enabled) and bool_or(parent_id is null) as visible
        from up
      ), down as (
        select c.id, h.path, h.visible, 0 as depth
        from catalog_category c, head h where c.id = ${id}
        union all
        select c.id, d.path || '/' || c.slug, d.visible and c.enabled, d.depth + 1
        from catalog_category c join down d on c.parent_id = d.id where d.depth < 50
      )
      select id, path, visible from down`,
  )
}

async function holder(ctx: ActionContext, path: string): Promise<string> {
  const [row] = await rows(
    ctx,
    sql`select s.kind, coalesce(p.name, c.name) as name from ${withRecord} where s.path = ${path}`,
  )
  return row ? `the ${String(row.kind)} "${String(row.name)}"` : 'another page'
}

/**
 * Brings `seo_path` in step with the record (and a category's subtree), inside the call's
 * transaction. A path that moved gets an automatic redirect from where it was.
 */
async function sync(ctx: ActionContext, kind: Kind, id: string): Promise<void> {
  const want = await wanted(ctx, kind, id)
  const ids = [...new Set([id, ...want.map((w) => String(w.id))])]
  const had = new Map(
    (
      await rows(
        ctx,
        sql`delete from seo_path where record_id in ${anyUuid(ids)} returning record_id, path`,
      )
    ).map((r) => [String(r.record_id), String(r.path)]),
  )
  const live: string[] = []
  const moved: { from: string; to: string }[] = []
  for (const w of want) {
    if (w.visible !== true) continue
    const path = String(w.path)
    if (RESERVED.includes(path.split('/')[1] ?? '')) {
      throw new ActionError(
        'conflict',
        `${path} is kept for the shop's own pages; choose another slug`,
      )
    }
    const claimed = await rows(
      ctx,
      sql`insert into seo_path (path, kind, record_id) values (${path}, ${kind}, ${w.id})
        on conflict do nothing returning path`,
    )
    if (claimed.length === 0) {
      throw new ActionError(
        'conflict',
        `${path} is taken by ${await holder(ctx, path)}; choose another slug`,
      )
    }
    live.push(path)
    const old = had.get(String(w.id))
    if (old !== undefined && old !== path) moved.push({ from: old, to: path })
  }
  await unredirect(ctx, live)
  for (const values of moved) {
    const made = await ctx.call('redirect.create', { values: { ...values, auto: true } })
    if (!made.ok && made.error.code === 'forbidden') {
      throw new ActionError('forbidden', 'Moving a page writes a redirect, which needs seo.write')
    }
    must(made)
  }
}

export const pathRules: ActionWrap[] = (['product', 'category'] as const).flatMap((kind) =>
  ['create', 'update', 'delete', 'restore'].map((verb): ActionWrap => ({
    action: `${kind}.${verb}`,
    module: 'seo',
    // Inside the catalog's own rules (order 0), so the record is checked before its path.
    order: 10,
    wrap: async (input: { id?: string }, ctx, next) => {
      const out = await next(input)
      await sync(ctx, kind, input.id ?? (out as { id: string }).id)
      return out
    },
  })),
)

export const resolve = defineAction({
  name: 'seo.resolve',
  description: 'What a storefront path shows: a product, a category, or a redirect to follow',
  input: z.object({ path: z.string().min(1).max(2000) }),
  output: pub(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('product'), id: z.string() }),
      z.object({ kind: z.literal('category'), id: z.string() }),
      z.object({
        kind: z.literal('redirect'),
        to: z.string(),
        status: z.union([z.literal(301), z.literal(302)]),
      }),
    ]),
  ),
  permission: null,
  risk: 'read',
  handler: async (input, ctx) => {
    let decoded = input.path
    try {
      decoded = decodeURI(input.path)
    } catch {
      // Not valid percent-encoding: look it up as given.
    }
    const paths = anyText([...new Set([input.path, decoded])])
    // The record is checked too, in case the paths are stale (seo was off and not rebuilt).
    const [page] = await rows(
      ctx,
      sql`select s.kind, s.record_id from ${withRecord} where s.path in ${paths} and ${visible}`,
    )
    if (page) return { kind: page.kind as Kind, id: String(page.record_id) }
    const [moved] = await rows(
      ctx,
      sql`select "to", status from seo_redirect where "from" in ${paths}`,
    )
    if (moved)
      return { kind: 'redirect' as const, to: String(moved.to), status: moved.status as 301 }
    throw new ActionError('not_found', 'Nothing at this path')
  },
})

export const rebuildPaths = defineAction({
  name: 'seo.rebuild-paths',
  description:
    'Rebuild the live paths from the catalog now (seo.rebuild does it in the background)',
  input: z.object({}),
  output: pub(z.object({ paths: z.number().int() })),
  permission: 'seo.manage',
  risk: 'write',
  handler: async (_input, ctx) => {
    await rows(ctx, sql`delete from seo_path`)
    // Categories first: a product whose slug equals a top-level category's stays without a page.
    await rows(
      ctx,
      sql`insert into seo_path (path, kind, record_id)
        with recursive tree as (
          select id, '/' || slug as path, 0 as depth from catalog_category
          where parent_id is null and enabled
          union all
          select c.id, t.path || '/' || c.slug, t.depth + 1
          from catalog_category c join tree t on c.parent_id = t.id where c.enabled and t.depth < 50)
        select path, 'category', id from tree
        where split_part(path, '/', 2) not in ${anyText(RESERVED)}
        on conflict do nothing`,
    )
    await rows(
      ctx,
      sql`insert into seo_path (path, kind, record_id)
        select '/' || slug, 'product', id from catalog_product
        where status = 'active' and slug not in ${anyText(RESERVED)}
        on conflict do nothing`,
    )
    const shadowed = await rows(
      ctx,
      sql`select r."from" from seo_redirect r join seo_path s on s.path = r."from"`,
    )
    await unredirect(
      ctx,
      shadowed.map((r) => String(r.from)),
    )
    const [count] = await rows(ctx, sql`select count(*)::int as n from seo_path`)
    return { paths: Number(count?.n) }
  },
})

export const rebuildJob = defineJob({
  name: 'seo.rebuild-paths',
  module: 'seo',
  description: 'Rebuild the live paths from the catalog',
  payload: z.strictObject({}),
  timeoutSeconds: 3600,
  handler: async (_payload, ctx) => {
    const result = await ctx.call('seo.rebuild-paths', {})
    if (!result.ok) throw new Error(result.error.message)
  },
})

export const rebuild = defineAction({
  name: 'seo.rebuild',
  description:
    'Rebuild every product and category URL in the background, after seo was switched back on',
  input: z.object({}),
  output: pub(z.object({ jobId: z.string(), duplicate: z.boolean() })),
  permission: 'seo.manage',
  risk: 'write',
  handler: async (_input, ctx) => {
    const { id, duplicate } = await ctx.service(jobs).enqueue(rebuildJob, {}, { key: 'rebuild' })
    return { jobId: id, duplicate }
  },
})
