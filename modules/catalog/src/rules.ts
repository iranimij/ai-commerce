import {
  ActionError,
  appInfo,
  attributeStore,
  resourceStore,
  type ActionContext,
  type ActionWrap,
  type AttributeDefinition,
  type ResourceDefinition,
  type ResourceRecord,
  type Result,
} from '@aicommerce/core'
import { databaseService } from '@aicommerce/db'
import { mediaFile } from '@aicommerce/module-media'
import { sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import {
  attributeSet,
  category,
  product,
  productVariant,
  type Link,
  type MediaEntry,
} from './resources.js'
import { slugify } from './slug.js'

type Row = Record<string, unknown>
type Product = Partial<z.infer<typeof product.fields>>
type Variant = Partial<z.infer<typeof productVariant.fields>>
type Category = Partial<z.infer<typeof category.fields>>

export const rows = async (ctx: ActionContext, query: SQL): Promise<Row[]> =>
  await ctx.service(databaseService).current().execute(query)

/** `in ${anyOf(ids)}`: a list of uuids as one parameter. */
export const anyOf = (ids: readonly string[]) =>
  sql`(select value::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`

/** Attributes on `product`, from modules and from the merchant. */
export const productAttributes = async (ctx: ActionContext): Promise<AttributeDefinition[]> => [
  ...ctx.service(appInfo).moduleAttributes('product'),
  ...(await ctx.service(attributeStore).list('product')),
]

const invalid = (field: string, message: string) =>
  new ActionError('invalid_input', message, [
    { code: 'custom', path: ['values', field], message, input: undefined },
  ])

/** The ids of `ids` that exist in a resource's table. */
async function existing(
  ctx: ActionContext,
  r: ResourceDefinition,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const found = await rows(
    ctx,
    sql`select id from ${sql.identifier(r.table)} where id in ${anyOf(ids)}`,
  )
  return new Set(found.map((row) => String(row.id)))
}

async function mustExist(
  ctx: ActionContext,
  r: ResourceDefinition,
  field: string,
  ids: string[],
): Promise<void> {
  const found = await existing(ctx, r, ids)
  const missing = ids.find((id) => !found.has(id))
  if (missing) throw invalid(field, `${r.label.singular} ${missing} does not exist`)
}

const files = (media: MediaEntry[] | undefined) =>
  (media ?? []).flatMap((m) => (m.kind === 'image' ? [m.file] : []))

/** The first of slug, slug-2, slug-3, ... that `taken` does not report. */
async function freeSlug(base: string, taken: (candidates: string[]) => Promise<Set<string>>) {
  const stem = Array.from(base).slice(0, 190).join('').replace(/-+$/, '')
  for (let start = 1; ; start += 50) {
    const candidates = Array.from({ length: 50 }, (_, i) =>
      i + start === 1 ? base : `${stem}-${String(i + start)}`,
    )
    const used = await taken(candidates)
    const free = candidates.find((c) => !used.has(c))
    if (free) return free
  }
}

const slugsIn = async (ctx: ActionContext, query: SQL) =>
  new Set((await rows(ctx, query)).map((r) => String(r.slug)))

/** Claims a SKU for a product or variant, releasing the one it held before. */
async function holdSku(ctx: ActionContext, owner: string, sku: string): Promise<void> {
  await rows(ctx, sql`delete from catalog_sku where owner = ${owner} and sku <> ${sku}`)
  await rows(
    ctx,
    sql`insert into catalog_sku (sku, owner) values (${sku}, ${owner})
    on conflict (sku) do nothing`,
  )
  const [holder] = await rows(ctx, sql`select owner from catalog_sku where sku = ${sku}`)
  if (String(holder?.owner) !== owner) {
    throw new ActionError('conflict', 'A product or variant with this SKU already exists')
  }
}

async function releaseSkus(ctx: ActionContext, owner: string): Promise<void> {
  await rows(ctx, sql`delete from catalog_sku where owner = ${owner}`)
}

async function variantCount(ctx: ActionContext, productId: string): Promise<number> {
  const [row] = await rows(
    ctx,
    sql`select count(*)::int as n from catalog_product_variant where product_id = ${productId}`,
  )
  return Number(row?.n)
}

/** Fails a nested call's result the same way, so the whole call rolls back. */
function must(result: Result<unknown>): unknown {
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

interface Rules<T> {
  resource: ResourceDefinition
  /** Fills in what create may leave out. */
  prepare?: (values: T, ctx: ActionContext) => Promise<T>
  /** Throws unless the record may become `values`. `before` is the record as it is now. */
  check: (
    values: T,
    ctx: ActionContext,
    before: ResourceRecord | null,
    id?: string,
  ) => Promise<void>
  /** After create, update and restore, in the same transaction. */
  written?: (record: ResourceRecord, ctx: ActionContext) => Promise<void>
  deleting?: (record: ResourceRecord, ctx: ActionContext) => Promise<void>
  deleted?: (record: ResourceRecord, ctx: ActionContext) => Promise<void>
}

/** The rules as wraps on the resource's own create, update, restore and delete. */
function guard<T>(rules: Rules<T>): ActionWrap[] {
  const r = rules.resource
  const store = (ctx: ActionContext) => ctx.service(resourceStore)
  const on = (
    verb: string,
    wrap: (
      input: Row,
      ctx: ActionContext,
      next: (input: unknown) => Promise<unknown>,
    ) => Promise<unknown>,
  ): ActionWrap => ({
    action: `${r.name}.${verb}`,
    module: 'catalog',
    order: 0,
    wrap,
  })
  const after = async (ctx: ActionContext, out: unknown) => {
    await rules.written?.(out as ResourceRecord, ctx)
    return out
  }
  return [
    on('create', async (input, ctx, next) => {
      let values = input.values as T
      if (rules.prepare) values = await rules.prepare(values, ctx)
      await rules.check(values, ctx, null)
      return after(ctx, await next({ ...input, values }))
    }),
    on('update', async (input, ctx, next) => {
      const id = input.id as string
      const before = await store(ctx).get(r, id)
      // A missing record or a stale version fails in the handler.
      if (before) await rules.check({ ...before, ...(input.values as T) }, ctx, before, id)
      return after(ctx, await next(input))
    }),
    on('restore', async (input, ctx, next) => {
      const revision = await store(ctx).revision(r, input.revisionId as string)
      const snapshot = r.fields.safeParse(revision?.after ?? revision?.before)
      // Without a revision or with an outdated one, the handler gives the error.
      if (revision && snapshot.success) {
        const before = await store(ctx).get(r, revision.recordId)
        await rules.check(snapshot.data as T, ctx, before, revision.recordId)
      }
      return after(ctx, await next(input))
    }),
    on('delete', async (input, ctx, next) => {
      const before = await store(ctx).get(r, input.id as string)
      if (before) await rules.deleting?.(before, ctx)
      const out = await next(input)
      if (before) await rules.deleted?.(before, ctx)
      return out
    }),
  ]
}

const productRules: Rules<Product> = {
  resource: product,
  prepare: async (values, ctx) =>
    values.slug !== undefined
      ? values
      : {
          ...values,
          slug: await freeSlug(slugify(values.name ?? ''), (c) =>
            slugsIn(
              ctx,
              sql`select slug from catalog_product where slug in (select jsonb_array_elements_text(${JSON.stringify(c)}::jsonb))`,
            ),
          ),
        },
  async check(p, ctx, before, id) {
    if (before && before.type !== p.type) {
      throw invalid('type', 'The type of a product cannot change; create a new product')
    }
    if (p.type === 'simple') {
      if ((p.prices ?? []).length === 0) throw invalid('prices', 'A simple product needs a price')
      if (p.configurableAttributes) {
        throw invalid(
          'configurableAttributes',
          'Only configurable products have configurable attributes',
        )
      }
    } else {
      const codes = p.configurableAttributes
      if (!codes) {
        throw invalid(
          'configurableAttributes',
          'A configurable product needs 1 to 3 select attributes',
        )
      }
      const selects = new Set(
        (await productAttributes(ctx)).filter((a) => a.type === 'select').map((a) => a.code),
      )
      const wrong = codes.find((c) => !selects.has(c))
      if (wrong)
        throw invalid('configurableAttributes', `"${wrong}" is not a select attribute of products`)
      const changed = JSON.stringify(before?.configurableAttributes) !== JSON.stringify(codes)
      if (before && id && changed && (await variantCount(ctx, id)) > 0) {
        throw new ActionError('conflict', 'Delete the variants before changing their attributes')
      }
    }
    await mustExist(ctx, category, 'categoryIds', p.categoryIds ?? [])
    await mustExist(ctx, mediaFile, 'media', files(p.media))
    const linked = (p.links ?? []).map((l: Link) => l.product)
    if (id && linked.includes(id)) throw invalid('links', 'A product cannot link to itself')
    await mustExist(ctx, product, 'links', linked)
    if (p.attributeSetId) await mustExist(ctx, attributeSet, 'attributeSetId', [p.attributeSetId])
  },
  written: (record, ctx) => holdSku(ctx, record.id, String(record.sku)),
  async deleting(record, ctx) {
    // Through the action, so each variant has its revision and audit entry.
    const store = ctx.service(resourceStore)
    for (;;) {
      const page = await store.list(productVariant, {
        filter: { productId: record.id },
        limit: 200,
      })
      if (page.items.length === 0) return
      for (const v of page.items) {
        must(await ctx.call('product-variant.delete', { id: v.id, version: v.version }))
      }
    }
  },
  deleted: (record, ctx) => releaseSkus(ctx, record.id),
}

const variantRules: Rules<Variant> = {
  resource: productVariant,
  async check(v, ctx, before, id) {
    if (before && before.productId !== v.productId) {
      throw invalid('productId', 'A variant cannot move to another product')
    }
    const parent = await ctx.service(resourceStore).get(product, v.productId ?? '')
    if (!parent) throw invalid('productId', 'Product does not exist')
    if (parent.type !== 'configurable')
      throw invalid('productId', 'Only configurable products have variants')
    const codes = (parent.configurableAttributes as string[] | undefined) ?? []
    const options = v.options ?? {}
    const defs = new Map((await productAttributes(ctx)).map((a) => [a.code, a]))
    const keys = Object.keys(options)
    if (keys.length !== codes.length || !codes.every((c) => c in options)) {
      throw invalid('options', `Give exactly one option for each of: ${codes.join(', ')}`)
    }
    for (const code of codes) {
      if (!defs.get(code)?.options?.includes(options[code] ?? '')) {
        throw invalid('options', `"${options[code] ?? ''}" is not an option of "${code}"`)
      }
    }
    const [twin] = await rows(
      ctx,
      sql`select id from catalog_product_variant where product_id = ${parent.id}
        and options = ${JSON.stringify(options)}::jsonb and id is distinct from ${id ?? null}::uuid`,
    )
    if (twin) throw new ActionError('conflict', 'Another variant of this product has these options')
    await mustExist(ctx, mediaFile, 'media', files(v.media))
  },
  written: (record, ctx) => holdSku(ctx, record.id, String(record.sku)),
  deleted: (record, ctx) => releaseSkus(ctx, record.id),
}

const categoryRules: Rules<Category> = {
  resource: category,
  prepare: async (values, ctx) =>
    values.slug !== undefined
      ? values
      : {
          ...values,
          slug: await freeSlug(slugify(values.name ?? ''), (c) =>
            slugsIn(
              ctx,
              sql`select slug from catalog_category where parent_id is not distinct from ${values.parentId ?? null}::uuid
                and slug in (select jsonb_array_elements_text(${JSON.stringify(c)}::jsonb))`,
            ),
          ),
        },
  async check(c, ctx, _before, id) {
    if (!c.parentId) return
    await mustExist(ctx, category, 'parentId', [c.parentId])
    if (!id) return
    const [loop] = await rows(
      ctx,
      sql`with recursive up (id, parent_id) as (
          select id, parent_id from catalog_category where id = ${c.parentId}
          union
          select p.id, p.parent_id from catalog_category p join up on p.id = up.parent_id)
        select 1 from up where id = ${id}`,
    )
    if (loop) throw invalid('parentId', 'A category cannot be its own ancestor')
  },
  async deleting(record, ctx) {
    const [row] = await rows(
      ctx,
      sql`select
        (select count(*)::int from catalog_category where parent_id = ${record.id}) as children,
        (select count(*)::int from catalog_product
          where category_ids @> ${JSON.stringify([record.id])}::jsonb) as products`,
    )
    const children = Number(row?.children)
    const products = Number(row?.products)
    if (children > 0) {
      throw new ActionError(
        'conflict',
        children === 1
          ? 'This category has 1 subcategory; move or delete it first'
          : `This category has ${String(children)} subcategories; move or delete them first`,
      )
    }
    if (products > 0) {
      throw new ActionError(
        'conflict',
        products === 1
          ? 'This category has 1 product; move or delete it first'
          : `This category has ${String(products)} products; move or delete them first`,
      )
    }
  },
}

const attributeSetRules: Rules<Partial<z.infer<typeof attributeSet.fields>>> = {
  resource: attributeSet,
  async check(s, ctx) {
    const known = new Set((await productAttributes(ctx)).map((a) => a.code))
    const wrong = (s.codes ?? []).find((c) => !known.has(c))
    if (wrong) throw invalid('codes', `"${wrong}" is not an attribute of products`)
  },
}

export const rules: ActionWrap[] = [
  ...guard(productRules),
  ...guard(variantRules),
  ...guard(categoryRules),
  ...guard(attributeSetRules),
]
