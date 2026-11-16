import {
  ActionError,
  classify,
  defineAction,
  resourceStore,
  settings,
  visibleAttributes,
  type ActionContext,
  type AttributeDefinition,
} from '@aicommerce/core'
import { mediaFile, mediaUrl } from '@aicommerce/module-media'
import { shopCurrency, shopLanguage } from '@aicommerce/module-setup'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { localize } from './localize.js'
import {
  attributeSet,
  category,
  product,
  type Link,
  type MediaEntry,
  type Price,
} from './resources.js'
import { anyOf, productAttributes, rows } from './rules.js'

// Everything here is what any visitor sees.
const pub = <S extends z.ZodType>(schema: S) => classify(schema, 'public')

const viewPrice = z.object({
  amount: z.number().int(),
  currency: z.string(),
  compareAt: z.number().int().optional(),
  /** A configurable product whose enabled variants differ in price: "from" the lowest. */
  from: z.boolean(),
})
export type ViewPrice = z.infer<typeof viewPrice>

const crumb = z.object({ id: z.string(), slug: z.string(), name: z.string() })
export type Crumb = z.infer<typeof crumb>

const viewMedia = z.union([
  z.object({
    kind: z.literal('image'),
    /** The media file, for other widths: `mediaUrl(id, width)`. */
    id: z.string(),
    url: z.string(),
    alt: z.string(),
    width: z.number().int(),
    height: z.number().int(),
  }),
  z.object({ kind: z.literal('video'), url: z.string() }),
])
export type ViewMedia = z.infer<typeof viewMedia>

export const productCardSchema = pub(
  z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    price: viewPrice.nullable(),
    image: z.object({ url: z.string(), alt: z.string() }).optional(),
  }),
)
export type ProductCard = z.infer<typeof productCardSchema>

export const productViewSchema = pub(
  z.object({
    id: z.string(),
    type: z.enum(['simple', 'configurable']),
    sku: z.string(),
    slug: z.string(),
    name: z.string(),
    shortDescription: z.string().optional(),
    description: z.string().optional(),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    price: viewPrice.nullable(),
    media: z.array(viewMedia),
    /** The configurable attributes, with the options enabled variants use, in option order. */
    options: z.array(
      z.object({
        code: z.string(),
        label: z.string(),
        values: z.array(
          z.object({
            value: z.string(),
            swatch: z
              .union([z.object({ color: z.string() }), z.object({ image: z.string() })])
              .optional(),
          }),
        ),
      }),
    ),
    variants: z.array(
      z.object({
        id: z.string(),
        sku: z.string(),
        options: z.record(z.string(), z.string()),
        price: viewPrice.nullable(),
        media: z.array(viewMedia),
      }),
    ),
    /** The first visible category's path, top first, that category last. */
    breadcrumbs: z.array(crumb),
    specifications: z.array(
      z.object({
        code: z.string(),
        label: z.string(),
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
      }),
    ),
    related: z.array(productCardSchema),
  }),
)
export type ProductView = z.infer<typeof productViewSchema>

interface MenuItem {
  id: string
  slug: string
  name: string
  children: MenuItem[]
}
const menuItem: z.ZodType<MenuItem> = z.lazy(() =>
  z.object({ id: z.string(), slug: z.string(), name: z.string(), children: z.array(menuItem) }),
)

const viewInput = {
  /** Default: the shop language. */
  locale: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
  /** Default: the shop currency. Prices are never converted. */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
}

interface Reading {
  locale: string
  fallback: string
  currency: string | undefined
}

async function reading(
  ctx: ActionContext,
  input: { locale?: string | undefined; currency?: string | undefined },
): Promise<Reading> {
  const s = ctx.service(settings)
  const fallback = (await s.get(shopLanguage)) ?? 'en'
  return {
    locale: input.locale ?? fallback,
    fallback,
    currency: input.currency ?? (await s.get(shopCurrency)),
  }
}

type Row = Record<string, unknown>

/** The given keys of `record` that hold text. */
const texts = <K extends string>(record: Row, keys: K[]) =>
  Object.fromEntries(
    keys.flatMap((k) => (typeof record[k] === 'string' ? [[k, record[k]]] : [])),
  ) as Partial<Record<K, string>>
type Files = Map<string, { width: number; height: number; alt?: string }>

const images = (media: unknown) =>
  ((media ?? []) as MediaEntry[]).flatMap((m) => (m.kind === 'image' ? [m.file] : []))

/** The media files of `ids` that still exist. */
async function filesOf(ctx: ActionContext, ids: string[]): Promise<Files> {
  if (ids.length === 0) return new Map()
  const found = await rows(
    ctx,
    sql`select id, width, height, alt from ${sql.identifier(mediaFile.table)}
      where id in ${anyOf([...new Set(ids)])}`,
  )
  return new Map(
    found.map((f) => [
      String(f.id),
      {
        width: Number(f.width),
        height: Number(f.height),
        ...(typeof f.alt === 'string' && { alt: f.alt }),
      },
    ]),
  )
}

function gallery(media: unknown, files: Files, alt: string): ViewMedia[] {
  return ((media ?? []) as MediaEntry[]).flatMap((m): ViewMedia[] => {
    if (m.kind === 'video') return [{ kind: 'video', url: m.url }]
    const f = files.get(m.file)
    if (!f) return []
    return [
      {
        kind: 'image',
        id: m.file,
        url: mediaUrl(m.file, 1280),
        alt: m.alt ?? f.alt ?? alt,
        width: f.width,
        height: f.height,
      },
    ]
  })
}

// The channel-free price in the currency; channels arrive in M6.
const pick = (prices: Price[] | undefined, currency: string | undefined) =>
  prices?.find((p) => p.currency === currency && p.channel === undefined)

/** A simple product's price, or the lowest of the enabled variants' (each falls back to the product's). */
function priceOf(
  type: unknown,
  prices: Price[] | undefined,
  variants: (Price[] | undefined)[],
  currency: string | undefined,
): ViewPrice | null {
  const found = (type === 'simple' ? [prices] : variants.map((v) => v ?? prices)).flatMap(
    (p) => pick(p, currency) ?? [],
  )
  const low = found.reduce<Price | undefined>(
    (a, b) => (a && a.amount <= b.amount ? a : b),
    undefined,
  )
  if (!low) return null
  return {
    amount: low.amount,
    currency: low.currency,
    ...(low.compareAt !== undefined && { compareAt: low.compareAt }),
    from: new Set(found.map((p) => p.amount)).size > 1,
  }
}

const named = (row: Row, r: Reading): Crumb => {
  const l = localize(
    {
      name: String(row.name),
      slug: String(row.slug),
      ...(row.translations ? { translations: row.translations } : {}),
    },
    r.locale,
    r.fallback,
  )
  return { id: String(row.id), slug: l.slug, name: l.name }
}

/** The path, top first, of each category that is visible: it and every ancestor enabled. */
async function paths(ctx: ActionContext, ids: string[], r: Reading): Promise<Map<string, Crumb[]>> {
  if (ids.length === 0) return new Map()
  const found = await rows(
    ctx,
    sql`with recursive up as (
        select id, parent_id, enabled, name, slug, translations, id as origin, 0 as depth
        from catalog_category where id in ${anyOf(ids)}
        union all
        select p.id, p.parent_id, p.enabled, p.name, p.slug, p.translations, up.origin, up.depth + 1
        from catalog_category p join up on p.id = up.parent_id where up.depth < 50)
      select * from up order by origin, depth desc`,
  )
  const byOrigin = new Map<string, Row[]>()
  for (const row of found) {
    const list = byOrigin.get(String(row.origin)) ?? []
    list.push(row)
    byOrigin.set(String(row.origin), list)
  }
  const out = new Map<string, Crumb[]>()
  for (const [origin, chain] of byOrigin) {
    const visible = chain[0]?.parent_id === null && chain.every((c) => c.enabled === true)
    if (visible)
      out.set(
        origin,
        chain.map((c) => named(c, r)),
      )
  }
  return out
}

/**
 * Cards for the active products among `ids`, in that order; others are left out. For search
 * results and related products.
 */
export async function productCards(
  ctx: ActionContext,
  ids: readonly string[],
  options: { locale?: string | undefined; currency?: string | undefined } = {},
): Promise<ProductCard[]> {
  if (ids.length === 0) return []
  const r = await reading(ctx, options)
  const found = await rows(
    ctx,
    sql`select id, type, name, slug, translations, prices, media from catalog_product
      where status = 'active' and id in ${anyOf(ids)}`,
  )
  const configurable = found.filter((p) => p.type === 'configurable').map((p) => String(p.id))
  const variantPrices = new Map<string, (Price[] | undefined)[]>()
  if (configurable.length > 0) {
    const variants = await rows(
      ctx,
      sql`select product_id, prices from catalog_product_variant
        where enabled and product_id in ${anyOf(configurable)}`,
    )
    for (const v of variants) {
      const list = variantPrices.get(String(v.product_id)) ?? []
      list.push((v.prices ?? undefined) as Price[] | undefined)
      variantPrices.set(String(v.product_id), list)
    }
  }
  const files = await filesOf(
    ctx,
    found.flatMap((p) => images(p.media)),
  )
  const byId = new Map(found.map((p) => [String(p.id), p]))
  return ids.flatMap((id): ProductCard[] => {
    const p = byId.get(id)
    if (!p) return []
    const { name, slug } = named(p, r)
    const image = gallery(p.media, files, name).find((m) => m.kind === 'image')
    return [
      {
        id,
        slug,
        name,
        price: priceOf(p.type, p.prices as Price[], variantPrices.get(id) ?? [], r.currency),
        ...(image && { image: { url: mediaUrl(image.id, 640), alt: image.alt } }),
      },
    ]
  })
}

function swatchOf(def: AttributeDefinition, value: string, files: Files) {
  const s = def.swatches?.[value]
  if (!s) return undefined
  if ('color' in s) return { color: s.color }
  return files.has(s.file) ? { image: mediaUrl(s.file, 160) } : undefined
}

export const productView = defineAction({
  name: 'catalog.product-view',
  description:
    'An active product as a visitor sees it: price, images, variants, breadcrumbs, specifications and related products',
  input: z.object({ id: z.uuid(), ...viewInput }),
  output: productViewSchema,
  permission: null,
  risk: 'read',
  handler: async (input, ctx) => {
    const store = ctx.service(resourceStore)
    const p = await store.get(product, input.id)
    if (!p || p.status !== 'active') throw new ActionError('not_found', 'Product not found')
    const r = await reading(ctx, input)
    const defs = await productAttributes(ctx)
    const byCode = new Map(defs.map((d) => [d.code, d]))
    // shortcut: at most 1000 variants shown; page them if a shop ever has more on one product.
    const variants =
      p.type === 'configurable'
        ? await rows(
            ctx,
            sql`select id, sku, options, prices, media from catalog_product_variant
              where product_id = ${p.id} and enabled order by position, sku limit 1000`,
          )
        : []
    // An attribute deleted since the product was saved is left out.
    const axes = ((p.configurableAttributes ?? []) as string[]).flatMap((code) => {
      const d = byCode.get(code)
      return d?.type === 'select' ? [d] : []
    })
    const files = await filesOf(ctx, [
      ...images(p.media),
      ...variants.flatMap((v) => images(v.media)),
      ...axes.flatMap((d) =>
        Object.values(d.swatches ?? {}).flatMap((s) => ('file' in s ? [s.file] : [])),
      ),
    ])
    const l = localize(p, r.locale, r.fallback) as typeof p
    const name = String(l.name)
    const prices = p.prices as Price[]
    const optionsOf = (v: Row): Record<string, string> => {
      const given = v.options as Record<string, string | undefined>
      return Object.fromEntries(
        axes.flatMap((d) => {
          const value = given[d.code]
          return value === undefined ? [] : [[d.code, value]]
        }),
      )
    }
    const categoryIds = p.categoryIds as string[]
    const visible = await paths(ctx, categoryIds, r)
    const breadcrumbs = categoryIds.map((id) => visible.get(id)).find(Boolean) ?? []

    const setId = texts(p, ['attributeSetId']).attributeSetId
    const set = setId ? await store.get(attributeSet, setId) : null
    const values = visibleAttributes(defs, p.attributes)
    const specifications = (
      (set?.codes as string[] | undefined) ?? defs.map((d) => d.code)
    ).flatMap((code) => {
      const d = byCode.get(code)
      const value = values[code] as string | number | boolean | string[] | undefined
      return d?.privacy === 'public' && value !== undefined ? [{ code, label: d.label, value }] : []
    })

    const linked = (p.links as Link[]).filter((k) => k.kind === 'related').map((k) => k.product)
    let related = (await productCards(ctx, linked, r)).slice(0, 8)
    const leaf = breadcrumbs.at(-1)
    if (related.length === 0 && leaf) {
      const same = await rows(
        ctx,
        sql`select id from catalog_product where status = 'active' and id <> ${p.id}
          and category_ids @> ${JSON.stringify([leaf.id])}::jsonb
          order by created_at desc, id limit 8`,
      )
      related = await productCards(
        ctx,
        same.map((s) => String(s.id)),
        r,
      )
    }

    return {
      id: p.id,
      type: p.type as 'simple' | 'configurable',
      sku: String(p.sku),
      slug: String(l.slug),
      name,
      ...texts(l, ['shortDescription', 'description', 'metaTitle', 'metaDescription']),
      price: priceOf(
        p.type,
        prices,
        variants.map((v) => (v.prices ?? undefined) as Price[] | undefined),
        r.currency,
      ),
      media: gallery(p.media, files, name),
      options: axes.map((d) => {
        const used = new Set(variants.map((v) => (v.options as Record<string, string>)[d.code]))
        return {
          code: d.code,
          label: d.label,
          values: (d.options ?? [])
            .filter((o) => used.has(o))
            .map((value) => {
              const swatch = swatchOf(d, value, files)
              return swatch ? { value, swatch } : { value }
            }),
        }
      }),
      variants: variants.map((v) => ({
        id: String(v.id),
        sku: String(v.sku),
        options: optionsOf(v),
        price: priceOf('simple', (v.prices ?? prices) as Price[], [], r.currency),
        media: gallery(v.media, files, name),
      })),
      breadcrumbs,
      specifications,
      related,
    }
  },
})

const sortItems = <T extends { name: string; position: number }>(items: T[], locale: string) =>
  items.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, locale))

export const categoryView = defineAction({
  name: 'catalog.category-view',
  description:
    'An enabled category as a visitor sees it, with its enabled subcategories and breadcrumbs',
  input: z.object({ id: z.uuid(), ...viewInput }),
  output: pub(
    z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      metaTitle: z.string().optional(),
      metaDescription: z.string().optional(),
      children: z.array(crumb),
      /** Top first, this category last. */
      breadcrumbs: z.array(crumb),
    }),
  ),
  permission: null,
  risk: 'read',
  handler: async (input, ctx) => {
    const r = await reading(ctx, input)
    const breadcrumbs = (await paths(ctx, [input.id], r)).get(input.id)
    const c = breadcrumbs && (await ctx.service(resourceStore).get(category, input.id))
    if (!breadcrumbs || !c) throw new ActionError('not_found', 'Category not found')
    const l = localize(c, r.locale, r.fallback) as typeof c
    // shortcut: at most 500 subcategories; page them if a shop ever has more under one.
    const children = await rows(
      ctx,
      sql`select id, name, slug, translations, position from catalog_category
        where parent_id = ${input.id} and enabled order by position, name limit 500`,
    )
    return {
      id: c.id,
      slug: String(l.slug),
      name: String(l.name),
      ...texts(l, ['description', 'metaTitle', 'metaDescription']),
      children: sortItems(
        children.map((row) => ({ ...named(row, r), position: Number(row.position) })),
        r.locale,
      ).map(({ id, slug, name }) => ({ id, slug, name })),
      breadcrumbs,
    }
  },
})

const MENU_DEPTH = 3

export const menu = defineAction({
  name: 'catalog.menu',
  description: 'The enabled category tree, three levels deep, in order',
  input: z.object(viewInput),
  output: pub(z.object({ items: z.array(menuItem) })),
  permission: null,
  risk: 'read',
  handler: async (input, ctx) => {
    const r = await reading(ctx, input)
    // shortcut: at most 2000 categories in the menu; a bigger tree needs a menu of its own.
    const found = await rows(
      ctx,
      sql`with recursive down as (
          select id, parent_id, name, slug, translations, position, 1 as depth
          from catalog_category where parent_id is null and enabled
          union all
          select c.id, c.parent_id, c.name, c.slug, c.translations, c.position, d.depth + 1
          from catalog_category c join down d on c.parent_id = d.id
          where c.enabled and d.depth < ${MENU_DEPTH})
        select * from down limit 2000`,
    )
    type Node = MenuItem & { position: number }
    const nodes = new Map<string, Node>(
      found.map((row) => [
        String(row.id),
        { ...named(row, r), position: Number(row.position), children: [] },
      ]),
    )
    const top: Node[] = []
    for (const row of found) {
      const node = nodes.get(String(row.id))
      if (!node) continue
      const parent = row.parent_id === null ? undefined : nodes.get(row.parent_id as string)
      if (row.parent_id === null) top.push(node)
      else parent?.children.push(node)
    }
    const strip = (list: Node[]): MenuItem[] =>
      sortItems(list, r.locale).map(({ id, slug, name, children }) => ({
        id,
        slug,
        name,
        children: strip(children as Node[]),
      }))
    return { items: strip(top) }
  },
})
