import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createDb, databaseEnv, parseEnv, type Database } from '@aicommerce/db'
import { parse, UsageError, type Io } from '../io.js'

type Client = Database['client']

const MAX_PRODUCTS = 10_000_000
const BATCH = 10_000

export function parseSeedArgs(argv: string[]): { products: number } {
  const { values, positionals } = parse(argv, { products: { type: 'string' } })
  if (positionals.length !== 1 || positionals[0] !== 'catalog') {
    throw new UsageError('seed takes catalog --products <n>')
  }
  const n = values.products ?? ''
  if (!/^\d{1,8}$/.test(n) || Number(n) < 1 || Number(n) > MAX_PRODUCTS) {
    throw new UsageError(`--products must be a whole number from 1 to ${String(MAX_PRODUCTS)}`)
  }
  return { products: Number(n) }
}

/** Writes a large test catalog straight into the database with COPY (a development tool). */
export async function seed(argv: string[], io: Io): Promise<number> {
  const { products } = parseSeedArgs(argv)
  if (io.env.AICOMMERCE_ALLOW_SEED !== '1') {
    io.err(
      'seed writes test data straight into the database, past every rule and audit. ' +
        'Set AICOMMERCE_ALLOW_SEED=1 to run it, on a development database only.',
    )
    return 1
  }
  const env = parseEnv(databaseEnv, io.env)
  const owner = createDb(env.MIGRATION_DATABASE_URL, { max: 1 })
  try {
    const started = performance.now()
    await seedCatalog(owner, products, io.out)
    io.out(
      `Seeded ${String(products)} products in ${((performance.now() - started) / 1000).toFixed(1)} s.`,
    )
    return 0
  } finally {
    await owner.close()
  }
}

// Fixed word lists and a seeded generator, so every seed of the same size holds the same catalog.
const COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  grey: '#808080',
  navy: '#1f2a44',
  blue: '#2f6fd6',
  red: '#c62828',
  green: '#2e7d32',
  yellow: '#f9d71c',
  orange: '#ef6c00',
  pink: '#ec7fa9',
  purple: '#6a1b9a',
  brown: '#6d4c41',
}
const SIZES = ['xs', 's', 'm', 'l', 'xl', 'xxl', '3xl', '4xl']
const MATERIALS = ['cotton', 'linen', 'wool', 'silk', 'denim', 'leather', 'polyester', 'cashmere']
const PATTERNS = ['plain', 'striped', 'checked', 'dotted', 'floral', 'printed', 'paisley', 'camo']
const BRANDS = ['North', 'Blue', 'Iron', 'Silver', 'Urban'].flatMap((a) =>
  ['Peak', 'Line', 'Craft', 'Works', 'Studio', 'Field', 'Harbor', 'Mill', 'Thread', 'Loom'].map(
    (b) => `${a} ${b}`,
  ),
)
export const SEED_NOUNS = [
  'shirt', 'blouse', 'sweater', 'hoodie', 'jacket', 'coat', 'parka', 'vest', 'dress', 'skirt',
  'trousers', 'jeans', 'shorts', 'leggings', 'jumpsuit', 'cardigan', 'polo', 'tunic', 'blazer',
  'suit', 'scarf', 'hat', 'cap', 'beanie', 'gloves', 'socks', 'belt', 'tie', 'bag', 'backpack',
  'wallet', 'sneakers', 'boots', 'sandals', 'loafers', 'slippers', 'pajamas', 'robe', 'swimsuit',
  'bikini', 'raincoat', 'poncho', 'kimono', 'overalls', 'chinos', 'joggers', 'tank', 'camisole',
  'bodysuit', 'windbreaker',
] // prettier-ignore
const ADJECTIVES = [
  'classic', 'modern', 'vintage', 'slim', 'relaxed', 'oversized', 'cropped', 'light', 'heavy',
  'soft', 'warm', 'cool', 'everyday', 'essential', 'premium', 'organic', 'recycled', 'tailored',
  'casual', 'formal', 'sporty', 'cozy', 'breathable', 'waterproof', 'stretch', 'washed', 'brushed',
  'quilted', 'knitted', 'woven',
] // prettier-ignore
const FILLER = [
  'made', 'from', 'fabric', 'that', 'keeps', 'its', 'shape', 'wash', 'after', 'wash', 'with',
  'a', 'comfortable', 'fit', 'for', 'every', 'day', 'seams', 'are', 'double', 'stitched', 'and',
  'the', 'finish', 'is', 'smooth', 'to', 'touch', 'easy', 'care', 'machine', 'washable', 'at',
  'thirty', 'degrees', 'designed', 'in', 'our', 'studio', 'produced', 'responsibly', 'pairs',
  'well', 'layers', 'travel', 'weekend', 'office', 'evening', 'season', 'durable', 'lightweight',
] // prettier-ignore
const TOP = [
  'Women', 'Men', 'Kids', 'Baby', 'Sports', 'Outdoor', 'Shoes', 'Accessories', 'Bags', 'Home',
  'Sleepwear', 'Swimwear', 'Workwear', 'Formal', 'Denim', 'Knitwear', 'Outerwear', 'Basics',
  'Sale', 'New',
] // prettier-ignore
const SUB = [
  'Tops',
  'Bottoms',
  'Dresses',
  'Jackets',
  'Layers',
  'Footwear',
  'Extras',
  'Gifts',
  'Picks',
]

/** The five public select attributes on product, in code order (the order search reads them). */
export const SEED_ATTRIBUTES: { code: string; label: string; options: string[] }[] = [
  { code: 'brand', label: 'Brand', options: BRANDS },
  { code: 'color', label: 'Color', options: Object.keys(COLORS) },
  { code: 'material', label: 'Material', options: MATERIALS },
  { code: 'pattern', label: 'Pattern', options: PATTERNS },
  { code: 'size', label: 'Size', options: SIZES },
]

/** mulberry32: small, fast and seeded. */
function generator(seed: number) {
  let a = seed
  const next = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T
  return { next, pick }
}

const title = (words: string[]) =>
  words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
const slug = (text: string) => text.toLowerCase().replaceAll(' ', '-')

/** One COPY text-format cell. */
const cell = (value: unknown): string =>
  value === null || value === undefined
    ? '\\N'
    : (typeof value === 'string' ? value : JSON.stringify(value)).replace(
        /[\\\t\n\r]/g,
        (c) => ({ '\\': '\\\\', '\t': '\\t', '\n': '\\n', '\r': '\\r' })[c] ?? c,
      )

async function copy(
  tx: Pick<Client, 'unsafe'>,
  table: string,
  columns: string[],
  rows: unknown[][],
) {
  if (rows.length === 0) return
  const text = rows.map((r) => r.map(cell).join('\t')).join('\n') + '\n'
  const stream = await tx.unsafe(`copy ${table} (${columns.join(', ')}) from stdin`).writable()
  await pipeline(Readable.from([text]), stream)
}

const PRODUCT_COLUMNS = [
  'id', 'version', 'created_at', 'updated_at', 'attributes', 'type', 'sku', 'name', 'slug',
  'status', 'short_description', 'description', 'prices', 'configurable_attributes',
  'category_ids', 'media', 'links',
] // prettier-ignore
const VARIANT_COLUMNS = [
  'id', 'version', 'created_at', 'updated_at', 'attributes', 'product_id', 'sku', 'options',
  'prices', 'media', 'enabled', 'position',
] // prettier-ignore
const DOC_COLUMNS = [
  'id',
  'status',
  'name',
  'created_at',
  'a',
  'b',
  'c',
  'd',
  'categories',
  'facets',
  'prices',
]

/**
 * Writes `count` products (every tenth configurable, with 4 variants), 200 categories in two
 * levels and the 5 attributes, and every product's search document, as `search.index` would.
 * Refuses a database whose catalog is not empty.
 */
export async function seedCatalog(
  database: Database,
  count: number,
  log: (line: string) => void,
): Promise<void> {
  const sql = database.client
  const [tables] = await sql`select to_regclass('catalog_product') as catalog,
    to_regclass('search_document') as search`
  if (!tables?.catalog || !tables.search) {
    throw new Error('The catalog and search tables are missing: switch search on, then migrate')
  }
  const [taken] = await sql`select exists (select 1 from catalog_product) as products,
    exists (select 1 from attribute where resource = 'product'
      and code in ${sql(SEED_ATTRIBUTES.map((a) => a.code))}) as attributes`
  if (taken?.products || taken?.attributes) {
    throw new Error('The catalog already has products or product attributes; seed an empty one')
  }
  const [language] = await sql`select value #>> '{}' as v from setting
    where key = 'shop.language' and channel is null`
  const config = (language?.v ?? 'en') === 'en' ? 'english' : 'simple'
  const random = generator(20261116)
  const epoch = Date.UTC(2024, 0, 1)
  const at = (i: number) => new Date(epoch + i * 30_000).toISOString()

  // Categories: 20 top-level, each with 9 children. Products go in the children.
  const parents = new Map<string, string>()
  const leaves: string[] = []
  const categories: unknown[][] = []
  TOP.forEach((top, t) => {
    const id = randomUUID()
    categories.push([id, 1, at(0), at(0), '{}', top, slug(top), null, t, true])
    SUB.forEach((sub, s) => {
      const child = randomUUID()
      parents.set(child, id)
      leaves.push(child)
      const name = `${top} ${sub}`
      categories.push([child, 1, at(0), at(0), '{}', name, slug(name), id, s, true])
    })
  })
  await sql.begin(async (tx) => {
    await copy(
      tx,
      'catalog_category',
      [
        'id',
        'version',
        'created_at',
        'updated_at',
        'attributes',
        'name',
        'slug',
        'parent_id',
        'position',
        'enabled',
      ],
      categories,
    )
    for (const a of SEED_ATTRIBUTES) {
      const swatches =
        a.code === 'color'
          ? Object.fromEntries(Object.entries(COLORS).map(([k, color]) => [k, { color }]))
          : null
      await tx`insert into attribute (resource, code, label, type, options, swatches, required, privacy)
        values ('product', ${a.code}, ${a.label}, 'select', ${JSON.stringify(a.options)}::jsonb,
          ${swatches && JSON.stringify(swatches)}::jsonb, false, 'public')`
    }
  })
  log(
    `Wrote ${String(categories.length)} categories and ${String(SEED_ATTRIBUTES.length)} attributes.`,
  )

  const colors = Object.keys(COLORS)
  for (let start = 0; start < count; start += BATCH) {
    const products: unknown[][] = []
    const variants: unknown[][] = []
    const skus: unknown[][] = []
    const docs: unknown[][] = []
    for (let i = start; i < Math.min(start + BATCH, count); i++) {
      const id = randomUUID()
      const configurable = i % 10 === 0
      const noun = random.pick(SEED_NOUNS)
      const adjective = random.pick(ADJECTIVES)
      const material = random.pick(MATERIALS)
      const brand = random.pick(BRANDS)
      const pattern = random.pick(PATTERNS)
      const color = random.pick(colors)
      const size = random.pick(SIZES)
      const name = title(
        configurable ? [adjective, material, noun] : [adjective, color, material, noun],
      )
      const sku = `SEED-${String(i).padStart(8, '0')}`
      const status = i % 20 === 19 ? 'draft' : 'active'
      const short = `${title([adjective])} ${noun} in ${material}, by ${brand}.`
      const description = Array.from({ length: 30 + Math.floor(random.next() * 30) }, () =>
        random.pick(FILLER),
      ).join(' ')
      const amount = 500 + Math.floor(random.next() * 49_500)
      const prices = [{ currency: 'EUR', amount }]
      const leaf = random.pick(leaves)
      const created = at(i)
      // Code order, as search reads them; a configurable product's color and size are its variants'.
      const attributes: Record<string, string> = configurable
        ? { brand, material, pattern }
        : { brand, color, material, pattern, size }
      products.push([
        id, 1, created, created, attributes, configurable ? 'configurable' : 'simple', sku, name,
        `${slug(name)}-${String(i)}`, status, short, description, prices,
        configurable ? ['color', 'size'] : null, [leaf], [], [],
      ]) // prettier-ignore
      skus.push([sku, id])

      const facets: Record<string, string[]> = Object.fromEntries(
        Object.entries(attributes).map(([k, v]) => [k, [v]]),
      )
      const own: { sku: string; options: Record<string, string> }[] = []
      if (configurable) {
        // Two colours by two sizes; jsonb keeps the keys shortest first, as search reads them.
        const pair = [color, colors[(colors.indexOf(color) + 1) % colors.length] ?? color]
        const fit = [size, SIZES[(SIZES.indexOf(size) + 1) % SIZES.length] ?? size]
        for (const c of pair) {
          for (const s of fit) {
            const variant = {
              sku: `${sku}-${String(own.length + 1)}`,
              options: { size: s, color: c },
            }
            const variantId = randomUUID()
            variants.push([
              variantId, 1, created, created, '{}', id, variant.sku, variant.options, null, [],
              true, own.length,
            ]) // prettier-ignore
            skus.push([variant.sku, variantId])
            own.push(variant)
          }
        }
        facets.color = pair
        facets.size = fit
      }
      // As the engine builds the document (modules/search/src/engine.ts, index).
      const b = [
        sku,
        ...own.map((v) => v.sku),
        ...Object.values(attributes),
        ...own.flatMap((v) => Object.values(v.options)),
      ].join(' ')
      docs.push([
        id, status, name, created, name, b, short, description, [leaf, parents.get(leaf)], facets,
        { EUR: amount },
      ]) // prettier-ignore
    }
    await sql.begin(async (tx) => {
      await copy(tx, 'catalog_product', PRODUCT_COLUMNS, products)
      await copy(tx, 'catalog_product_variant', VARIANT_COLUMNS, variants)
      await copy(tx, 'catalog_sku', ['sku', 'owner'], skus)
      await tx`create temp table seed_doc (id uuid, status text, name text, created_at timestamptz,
        a text, b text, c text, d text, categories jsonb, facets jsonb, prices jsonb) on commit drop`
      await copy(tx, 'seed_doc', DOC_COLUMNS, docs)
      const weighted = (column: string, weight: string) =>
        tx`setweight(to_tsvector(${config}::regconfig,
          public.unaccent('public.unaccent'::regdictionary, ${tx(column)})), ${weight}::"char")`
      await tx`insert into search_document
          (product_id, status, name, names, created_at, tsv, suggest, categories, facets, prices)
        select id, status, name, '{}', created_at,
          ${weighted('a', 'A')} || ${weighted('b', 'B')} || ${weighted('c', 'C')} || ${weighted('d', 'D')},
          public.unaccent('public.unaccent'::regdictionary, a), categories, facets, prices
        from seed_doc`
      await tx`insert into search_word (word)
        select distinct w.lexeme from seed_doc s, unnest(to_tsvector('simple',
          public.unaccent('public.unaccent'::regdictionary, s.a))) w
        on conflict do nothing`
    })
    log(`Seeded ${String(Math.min(start + BATCH, count))} / ${String(count)} products`)
  }
  await sql`analyze catalog_category, catalog_product, catalog_product_variant, catalog_sku,
    attribute, search_document`
}
