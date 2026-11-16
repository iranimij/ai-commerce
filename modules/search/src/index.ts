import { fileURLToPath } from 'node:url'
import {
  ActionError,
  appInfo,
  attributeStore,
  classify,
  defineAction,
  defineJob,
  defineModule,
  jobs,
  provide,
  settings,
  type ActionContext,
  type AttributeDefinition,
} from '@aicommerce/core'
import { databaseService, type MigrationSource } from '@aicommerce/db'
import { productCards, productCardSchema } from '@aicommerce/module-catalog'
import { mediaFile, mediaUrl } from '@aicommerce/module-media'
import { shopCurrency, shopLanguage } from '@aicommerce/module-setup'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { postgresSearchEngine, searchEngine } from './engine.js'
import { sync } from './sync.js'

export {
  postgresSearchEngine,
  searchEngine,
  type SearchEngine,
  type SearchQuery,
  type SearchResult,
  type SearchSort,
  type Suggestions,
} from './engine.js'

export const searchMigrations: MigrationSource = {
  module: 'search',
  dir: fileURLToPath(new URL('../migrations', import.meta.url)),
}

const pub = <S extends z.ZodType>(schema: S) => classify(schema, 'public')

const locale = z
  .string()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
  .optional()
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .optional()
const code = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
/** PostgreSQL text cannot hold a NUL character: refused here rather than failing there. */
const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !s.includes('\0'), 'Remove the NUL character')
const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)

const MAX_FILTERS = 20

/** Public select and multiselect attributes on products: the filters a visitor may use. */
async function facetAttributes(ctx: ActionContext): Promise<AttributeDefinition[]> {
  const defs = [
    ...ctx.service(appInfo).moduleAttributes('product'),
    ...(await ctx.service(attributeStore).list('product')),
  ]
  return defs.filter(
    (d) => d.privacy === 'public' && (d.type === 'select' || d.type === 'multiselect'),
  )
}

/** The swatch files among `ids` that still exist. */
async function existingFiles(ctx: ActionContext, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const found: Record<string, unknown>[] = await ctx
    .service(databaseService)
    .current()
    .execute(
      sql`select id from ${sql.identifier(mediaFile.table)}
        where id in (select value::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`,
    )
  return new Set(found.map((f) => String(f.id)))
}

const swatch = z.union([z.object({ color: z.string() }), z.object({ image: z.string() })])

export const query = defineAction({
  name: 'search.query',
  description:
    'Search active products by words, category, attribute filters and price, sorted and paged, with filter counts',
  input: z.object({
    q: text(0, 200).optional(),
    /** Includes its subcategories. */
    categoryId: z.uuid().optional(),
    /** By attribute code: a product matches every code and any value within one. */
    filters: z
      .record(code, z.array(text(1, 200)).min(1).max(50))
      .refine((f) => Object.keys(f).length <= MAX_FILTERS, `At most ${String(MAX_FILTERS)} filters`)
      .optional(),
    /** In minor units of the currency. */
    price: z.strictObject({ min: amount.optional(), max: amount.optional() }).optional(),
    /** Default: the shop currency. Prices are never converted. */
    currency,
    /** Default: the shop language. */
    locale,
    /** Default: relevance when `q` has words, else newest. */
    sort: z.enum(['relevance', 'price-asc', 'price-desc', 'name', 'newest']).optional(),
    cursor: z.string().max(1000).optional(),
    limit: z.number().int().min(1).max(48).default(24),
  }),
  output: pub(
    z.object({
      items: z.array(productCardSchema),
      total: z.number().int(),
      facets: z.array(
        z.object({
          code: z.string(),
          label: z.string(),
          options: z.array(
            z.object({ value: z.string(), count: z.number().int(), swatch: swatch.optional() }),
          ),
        }),
      ),
      nextCursor: z.string().nullable(),
    }),
  ),
  permission: null,
  risk: 'read',
  handler: async (input, ctx) => {
    const defs = await facetAttributes(ctx)
    const byCode = new Map(defs.map((d) => [d.code, d]))
    const filters = input.filters ?? {}
    const unknown = Object.keys(filters).find((c) => !byCode.has(c))
    if (unknown) throw new ActionError('invalid_input', `"${unknown}" is not a filter`)
    const s = ctx.service(settings)
    const lang = input.locale ?? (await s.get(shopLanguage)) ?? 'en'
    const cur = input.currency ?? (await s.get(shopCurrency))
    const q = input.q ?? ''
    const result = await ctx.service(searchEngine).query(ctx, {
      ...(q !== '' && { q }),
      categoryId: input.categoryId,
      filters,
      price: input.price,
      currency: cur,
      locale: lang,
      sort: input.sort ?? (q === '' ? 'newest' : 'relevance'),
      cursor: input.cursor,
      limit: input.limit,
      facets: defs.map((d) => d.code),
    })
    const files = await existingFiles(
      ctx,
      defs.flatMap((d) =>
        Object.values(d.swatches ?? {}).flatMap((w) => ('file' in w ? [w.file] : [])),
      ),
    )
    const facets = result.facets.flatMap(({ code: c, counts }) => {
      const d = byCode.get(c)
      if (!d) return []
      const n = new Map(counts.map((x) => [x.value, x.count]))
      // In the attribute's option order; values no longer among its options are left out.
      const options = (d.options ?? []).flatMap((value) => {
        const count = n.get(value)
        if (count === undefined) return []
        const w = d.swatches?.[value]
        const sw = !w
          ? undefined
          : 'color' in w
            ? { color: w.color }
            : files.has(w.file)
              ? { image: mediaUrl(w.file, 160) }
              : undefined
        return [sw ? { value, count, swatch: sw } : { value, count }]
      })
      return options.length > 0 ? [{ code: c, label: d.label, options }] : []
    })
    return {
      items: await productCards(ctx, result.ids, { locale: lang, currency: cur }),
      total: result.total,
      facets,
      nextCursor: result.nextCursor,
    }
  },
})

export const suggest = defineAction({
  name: 'search.suggest',
  description: 'Products and categories whose names match what a visitor is typing, typos allowed',
  input: z.object({ q: text(2, 100), locale }),
  output: pub(
    z.object({
      products: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string() })),
      categories: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  ),
  permission: null,
  risk: 'read',
  handler: async (input, ctx) => {
    const lang = input.locale ?? (await ctx.service(settings).get(shopLanguage)) ?? 'en'
    return await ctx.service(searchEngine).suggest(ctx, input.q, lang)
  },
})

const PAGE = 500

export const reindexPage = defineAction({
  name: 'search.reindex-page',
  description: 'Index the next 500 products by id; used by the search.rebuild job',
  input: z.object({ after: z.uuid().optional() }),
  output: z.object({ next: z.string().nullable() }),
  permission: 'search.manage',
  risk: 'write',
  handler: async (input, ctx) => {
    const ids: Record<string, unknown>[] = await ctx
      .service(databaseService)
      .current()
      .execute(
        sql`select id from catalog_product where id > ${input.after ?? '00000000-0000-0000-0000-000000000000'}::uuid
          order by id limit ${PAGE}`,
      )
    const engine = ctx.service(searchEngine)
    await engine.index(
      ctx,
      ids.map((r) => String(r.id)),
    )
    if (ids.length < PAGE) {
      await engine.prune(ctx)
      return { next: null }
    }
    return { next: String(ids.at(-1)?.id) }
  },
})

export const rebuild = defineJob({
  name: 'search.rebuild',
  module: 'search',
  description: 'Index every product again, 500 at a time',
  payload: z.strictObject({}),
  // Each page commits on its own, so a retry redoes at most the whole run, never corrupts it.
  timeoutSeconds: 3600,
  handler: async (_payload, ctx) => {
    let after: string | null = null
    do {
      const result = await ctx.call('search.reindex-page', after ? { after } : {})
      if (!result.ok) throw new Error(result.error.message)
      after = (result.output as { next: string | null }).next
    } while (after)
  },
})

export const reindex = defineAction({
  name: 'search.reindex',
  description:
    'Rebuild the search index in the background, for example after switching search back on',
  input: z.object({}),
  output: z.object({ jobId: z.string(), duplicate: z.boolean() }),
  permission: 'search.manage',
  risk: 'write',
  handler: async (_input, ctx) => {
    const { id, duplicate } = await ctx
      .service(jobs)
      .enqueue(rebuild, {}, { key: 'search.rebuild' })
    return { jobId: id, duplicate }
  },
})

export const search = defineModule({
  name: 'search',
  label: 'Search',
  description: 'Full-text product search with filters, sorting and suggestions',
  depends: ['catalog'],
  actions: [query, suggest, reindex, reindexPage],
  jobs: [rebuild],
  wraps: sync,
  provides: [provide(searchEngine, 'search', postgresSearchEngine)],
})
