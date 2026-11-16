import { classify, defineResource } from '@aicommerce/core'
import { z } from 'zod'
import { isSlug } from './slug.js'

const pub = <S extends z.ZodType>(schema: S) => classify(schema, 'public')

/** One set for all four resources: deleting a product deletes its variants in the same call. */
const permissions = { read: 'catalog.read', write: 'catalog.write', delete: 'catalog.delete' }

const unique =
  <T>(key: (item: T) => string) =>
  (items: T[]) =>
    new Set(items.map(key)).size === items.length

const name = z.string().trim().min(1).max(255)
const slug = z.string().refine(isSlug, 'Use lower-case letters and digits, words joined by "-"')
/** Markdown, never HTML. */
const markdown = (max: number) => z.string().max(max)
const metaTitle = z.string().max(255)
const metaDescription = z.string().max(500)
export const attributeCode = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const sku = z.string().trim().min(1).max(64)

export const translation = z.strictObject({
  name: name.optional(),
  slug: slug.optional(),
  shortDescription: markdown(5000).optional(),
  description: markdown(50_000).optional(),
  metaTitle: metaTitle.optional(),
  metaDescription: metaDescription.optional(),
})
/** By locale (`fa`, `pt-BR`); each field falls back to the shop language, then the record's own. */
export const translations = z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), translation)

export const price = z.strictObject({
  /** ISO 4217. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** In minor units (cents). */
  amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  compareAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  channel: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,63}$/)
    .optional(),
})
export type Price = z.infer<typeof price>
const prices = z
  .array(price)
  .max(100)
  .refine(
    unique((p: Price) => `${p.currency}/${p.channel ?? ''}`),
    'At most one price per currency and channel',
  )

const VIDEO_HOST = /^((www\.|m\.)?youtube\.com|youtu\.be|(www\.|player\.)?vimeo\.com)$/
export const mediaEntry = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('image'),
    /** A media-file id. */
    file: z.uuid(),
    alt: z.string().max(500).optional(),
  }),
  z.strictObject({
    kind: z.literal('video'),
    url: z.url({ protocol: /^https$/, hostname: VIDEO_HOST }).max(500),
  }),
])
export type MediaEntry = z.infer<typeof mediaEntry>
const media = z.array(mediaEntry).max(50)

export const link = z.strictObject({
  kind: z.enum(['related', 'upsell', 'crosssell']),
  product: z.uuid(),
})
export type Link = z.infer<typeof link>

export const category = defineResource({
  name: 'category',
  module: 'catalog',
  label: { singular: 'Category', plural: 'Categories' },
  fields: z.strictObject({
    name: pub(name),
    /** Default: from the name, made unique among its siblings with -2, -3, ... */
    slug: pub(slug).optional(),
    /** `null` on update moves it to the top level. */
    parentId: pub(z.uuid()).nullable().optional(),
    position: pub(z.number().int()).default(0),
    enabled: pub(z.boolean()).default(true),
    description: pub(markdown(50_000)).optional(),
    metaTitle: pub(metaTitle).optional(),
    metaDescription: pub(metaDescription).optional(),
    translations: pub(translations).optional(),
  }),
  permissions,
})

export const attributeSet = defineResource({
  name: 'attribute-set',
  module: 'catalog',
  label: { singular: 'Attribute set', plural: 'Attribute sets' },
  fields: z.strictObject({
    name: pub(name),
    /** Attribute codes on `product`, in the order a product page lists them. */
    codes: pub(z.array(attributeCode).max(200).refine(unique(String), 'Codes must be unique')),
  }),
  permissions,
})

export const product = defineResource({
  name: 'product',
  module: 'catalog',
  label: { singular: 'Product', plural: 'Products' },
  attributes: true,
  fields: z.strictObject({
    /** Fixed once created. */
    type: pub(z.enum(['simple', 'configurable'])),
    /** Unique across products and variants. */
    sku: pub(sku),
    name: pub(name),
    /** Default: from the name, made unique with -2, -3, ... It changes only when it is given. */
    slug: pub(slug).optional(),
    status: pub(z.enum(['draft', 'active', 'archived'])).default('draft'),
    shortDescription: pub(markdown(5000)).optional(),
    description: pub(markdown(50_000)).optional(),
    /** A simple product needs at least one. A variant without its own uses these. */
    prices: pub(prices).default([]),
    /** 1 to 3 select attributes on `product`; required for configurable, refused for simple. */
    configurableAttributes: pub(
      z.array(attributeCode).min(1).max(3).refine(unique(String), 'Codes must be unique'),
    ).optional(),
    categoryIds: pub(
      z.array(z.uuid()).max(50).refine(unique(String), 'Ids must be unique'),
    ).default([]),
    media: pub(media).default([]),
    links: pub(
      z
        .array(link)
        .max(100)
        .refine(
          unique((l: Link) => `${l.kind}/${l.product}`),
          'Links must be unique',
        ),
    ).default([]),
    /** `null` on update removes it. */
    attributeSetId: pub(z.uuid()).nullable().optional(),
    metaTitle: pub(metaTitle).optional(),
    metaDescription: pub(metaDescription).optional(),
    translations: pub(translations).optional(),
  }),
  permissions,
})

export const productVariant = defineResource({
  name: 'product-variant',
  module: 'catalog',
  label: { singular: 'Product variant', plural: 'Product variants' },
  fields: z.strictObject({
    /** A configurable product; fixed once created. */
    productId: pub(z.uuid()),
    sku: pub(sku),
    /** One option for each of the product's configurable attributes. */
    options: pub(z.record(attributeCode, z.string().min(1).max(200))),
    /** Default: the product's prices. */
    prices: pub(prices).optional(),
    media: pub(media).default([]),
    enabled: pub(z.boolean()).default(true),
    position: pub(z.number().int()).default(0),
  }),
  permissions,
})
