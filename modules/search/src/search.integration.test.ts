import {
  attributeInput,
  attributeStore,
  createApp,
  createSettingsReader,
  guestActor,
  jobs,
  merchantAttribute,
  provide,
  resourceStore,
  settings,
  type Actor,
  type ResourceRecord,
  type Result,
} from '@aicommerce/core'
import {
  coreMigrations,
  createDbAuditSink,
  createPgAttributeStore,
  createPgJobQueue,
  createPgResourceStore,
  createWorker,
  databaseService,
  runMigrations,
} from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import { catalog, catalogMigrations, type ProductCard } from '@aicommerce/module-catalog'
import { media, mediaMigrations } from '@aicommerce/module-media'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { search, searchMigrations } from './index.js'

let database: TestDb
let app: ReturnType<typeof createApp>
const admin: Actor = { type: 'admin', id: 'admin-1', permissions: new Set(['*']) }
const shop: Record<string, string> = { 'shop.currency': 'EUR', 'shop.language': 'en' }

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(
    database,
    [coreMigrations, mediaMigrations, catalogMigrations, searchMigrations],
    {
      log: () => undefined,
    },
  )
  app = createApp({
    modules: [media, catalog, search],
    enabled: ['media', 'catalog', 'search'],
    services: [
      provide(resourceStore, 'app', createPgResourceStore(database)),
      provide(attributeStore, 'app', createPgAttributeStore(database)),
      provide(databaseService, 'app', database),
      provide(jobs, 'app', createPgJobQueue(database)),
      provide(
        settings,
        'app',
        createSettingsReader({
          read: (key) => Promise.resolve(key in shop ? { value: shop[key] } : undefined),
        }),
      ),
    ],
    audit: createDbAuditSink(database),
    transaction: database.transaction,
    onError: (error) => {
      console.error(error)
    },
  })
})
afterAll(async () => {
  await database.drop()
})
beforeEach(async () => {
  await database.client`truncate catalog_category, catalog_attribute_set, catalog_product,
    catalog_product_variant, catalog_sku, media_media_file, attribute, search_document, job`
})

const call = (name: string, input: unknown, actor: Actor = admin) =>
  app.registry.call(name, input, { actor, confirmed: true })

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function output<T = ResourceRecord>(result: Result<unknown>): T {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.output as T
}
function failure(result: Result<unknown>) {
  if (result.ok) throw new Error('Expected a failure')
  return result.error
}

interface Found {
  items: ProductCard[]
  total: number
  facets: {
    code: string
    label: string
    options: { value: string; count: number; swatch?: object }[]
  }[]
  nextCursor: string | null
}
const find = async (input: object = {}) =>
  output<Found>(await call('search.query', input, guestActor))
const names = async (input: object = {}) => (await find(input)).items.map((i) => i.name).sort()
const counts = (found: Found, code: string) =>
  Object.fromEntries(
    (found.facets.find((f) => f.code === code)?.options ?? []).map((o) => [o.value, o.count]),
  )

const eur = (amount: number) => ({ currency: 'EUR', amount })
let serial = 0
const nextSku = () => `SKU-${String(++serial)}`

const product = async (values: Record<string, unknown> = {}, attributes?: object) =>
  output(
    await call('product.create', {
      values: {
        type: 'simple',
        sku: nextSku(),
        name: 'Shirt',
        status: 'active',
        prices: [eur(1000)],
        ...values,
      },
      ...(attributes && { attributes }),
    }),
  )
const category = async (values: Record<string, unknown> = {}) =>
  output(await call('category.create', { values: { name: 'Shirts', ...values } }))

/** A public merchant attribute on product. */
async function attribute(
  code: string,
  type: 'select' | 'multiselect',
  options: string[],
  extra: object = {},
) {
  await app.service(attributeStore).create(
    merchantAttribute(
      attributeInput.parse({
        resource: 'product',
        code,
        label: code.charAt(0).toUpperCase() + code.slice(1),
        type,
        options,
        privacy: 'public',
        ...extra,
      }),
    ),
  )
}

test('a new active product is found at once', async () => {
  await product({ name: 'Blue Oxford Shirt', shortDescription: 'Cotton, button-down collar' })
  await product({ name: 'Red Scarf' })
  expect(await names({ q: 'oxford' })).toEqual(['Blue Oxford Shirt'])
  // Stemmed, and the last word is a prefix while it is typed.
  expect(await names({ q: 'shirts' })).toEqual(['Blue Oxford Shirt'])
  expect(await names({ q: 'blue shi' })).toEqual(['Blue Oxford Shirt'])
  expect(await names({ q: 'cotton' })).toEqual(['Blue Oxford Shirt'])
  expect(await names()).toEqual(['Blue Oxford Shirt', 'Red Scarf'])
  const found = await find({ q: 'scarf' })
  expect(found).toMatchObject({ total: 1, nextCursor: null })
  expect(found.items[0]).toMatchObject({
    name: 'Red Scarf',
    price: { amount: 1000, currency: 'EUR' },
  })
})

test('a draft is never found', async () => {
  const draft = await product({ name: 'Secret Jacket', status: 'draft' })
  expect((await find({ q: 'jacket' })).total).toBe(0)
  expect((await find()).total).toBe(0)
  const active = output(
    await call('product.update', { id: draft.id, version: 1, values: { status: 'active' } }),
  )
  expect(await names({ q: 'jacket' })).toEqual(['Secret Jacket'])
  output(
    await call('product.update', {
      id: draft.id,
      version: active.version,
      values: { status: 'archived' },
    }),
  )
  expect((await find({ q: 'jacket' })).total).toBe(0)
  const live = await product({ name: 'Gone Jacket' })
  output(await call('product.delete', { id: live.id, version: 1 }))
  expect((await find({ q: 'jacket' })).total).toBe(0)
  expect(
    output<{ products: unknown[] }>(await call('search.suggest', { q: 'jacket' }, guestActor))
      .products,
  ).toEqual([])
})

test('filters are AND across codes and OR within one', async () => {
  await attribute('color', 'select', ['red', 'blue', 'green'])
  await attribute('material', 'multiselect', ['cotton', 'wool', 'silk'])
  await product({ name: 'A' }, { color: 'red', material: ['cotton'] })
  await product({ name: 'B' }, { color: 'blue', material: ['wool', 'cotton'] })
  await product({ name: 'C' }, { color: 'green', material: ['silk'] })
  await product({ name: 'D' }, { color: 'red', material: ['wool'] })
  expect(await names({ filters: { color: ['red'] } })).toEqual(['A', 'D'])
  expect(await names({ filters: { color: ['red', 'blue'] } })).toEqual(['A', 'B', 'D'])
  expect(await names({ filters: { color: ['red', 'blue'], material: ['cotton'] } })).toEqual([
    'A',
    'B',
  ])
  expect(await names({ filters: { material: ['wool', 'silk'] } })).toEqual(['B', 'C', 'D'])
  expect(await names({ filters: { color: ['green'], material: ['cotton'] } })).toEqual([])
})

test('facet counts ignore their own filter', async () => {
  await attribute('color', 'select', ['red', 'blue', 'green'], {
    swatches: { red: { color: '#ff0000' } },
  })
  await attribute('size', 'select', ['s', 'm'])
  await product({ name: 'A' }, { color: 'red', size: 's' })
  await product({ name: 'B' }, { color: 'blue', size: 's' })
  await product({ name: 'C' }, { color: 'red', size: 'm' })
  await product({ name: 'D', status: 'draft' }, { color: 'green', size: 's' })
  const all = await find()
  expect(counts(all, 'color')).toEqual({ red: 2, blue: 1 })
  expect(counts(all, 'size')).toEqual({ s: 2, m: 1 })
  expect(all.facets.find((f) => f.code === 'color')).toMatchObject({
    label: 'Color',
    options: [
      { value: 'red', count: 2, swatch: { color: '#ff0000' } },
      { value: 'blue', count: 1 },
    ],
  })
  const red = await find({ filters: { color: ['red'] } })
  expect(red.total).toBe(2)
  // Colour counts still show every colour; size counts are within red.
  expect(counts(red, 'color')).toEqual({ red: 2, blue: 1 })
  expect(counts(red, 'size')).toEqual({ s: 1, m: 1 })
  const redS = await find({ filters: { color: ['red'], size: ['s'] } })
  expect(redS.total).toBe(1)
  expect(counts(redS, 'color')).toEqual({ red: 1, blue: 1 })
  expect(counts(redS, 'size')).toEqual({ s: 1, m: 1 })
})

test('a variant colour is a filter on its product', async () => {
  await attribute('color', 'select', ['red', 'blue', 'green'])
  const tee = await product({
    name: 'Tee',
    type: 'configurable',
    prices: [eur(1500)],
    configurableAttributes: ['color'],
  })
  const red = output(
    await call('product-variant.create', {
      values: { productId: tee.id, sku: 'TEE-RED', options: { color: 'red' } },
    }),
  )
  output(
    await call('product-variant.create', {
      values: { productId: tee.id, sku: 'TEE-BLUE', options: { color: 'blue' }, enabled: false },
    }),
  )
  expect(await names({ filters: { color: ['red'] } })).toEqual(['Tee'])
  // A disabled variant's colour is not offered.
  expect(await names({ filters: { color: ['blue'] } })).toEqual([])
  expect(counts(await find(), 'color')).toEqual({ red: 1 })
  // Found by a variant's SKU too.
  expect(await names({ q: 'TEE-RED' })).toEqual(['Tee'])
  output(
    await call('product-variant.update', {
      id: red.id,
      version: 1,
      values: { options: { color: 'green' } },
    }),
  )
  expect(await names({ filters: { color: ['red'] } })).toEqual([])
  expect(await names({ filters: { color: ['green'] } })).toEqual(['Tee'])
  output(await call('product-variant.delete', { id: red.id, version: 2 }))
  expect(await names({ filters: { color: ['green'] } })).toEqual([])
})

test('a category filter includes subcategories, and moving a category reindexes', async () => {
  const men = await category({ name: 'Men' })
  const women = await category({ name: 'Women' })
  const shirts = await category({ name: 'Shirts', parentId: men.id })
  const formal = await category({ name: 'Formal', parentId: shirts.id })
  await product({ name: 'Oxford', categoryIds: [formal.id] })
  await product({ name: 'Polo', categoryIds: [shirts.id] })
  await product({ name: 'Dress', categoryIds: [women.id] })
  expect(await names({ categoryId: men.id })).toEqual(['Oxford', 'Polo'])
  expect(await names({ categoryId: shirts.id })).toEqual(['Oxford', 'Polo'])
  expect(await names({ categoryId: formal.id })).toEqual(['Oxford'])
  // Move Shirts (and Formal with it) under Women.
  output(
    await call('category.update', { id: shirts.id, version: 1, values: { parentId: women.id } }),
  )
  expect(await names({ categoryId: men.id })).toEqual([])
  expect(await names({ categoryId: women.id })).toEqual(['Dress', 'Oxford', 'Polo'])
  // A disabled category hides its products from its own and its ancestors' listings.
  output(await call('category.update', { id: shirts.id, version: 2, values: { enabled: false } }))
  expect(await names({ categoryId: women.id })).toEqual(['Dress'])
  expect(await names({ categoryId: formal.id })).toEqual([])
  // They are still found by words.
  expect(await names({ q: 'oxford' })).toEqual(['Oxford'])
  output(await call('category.update', { id: shirts.id, version: 3, values: { enabled: true } }))
  expect(await names({ categoryId: formal.id })).toEqual(['Oxford'])
})

test('price sort and filter use the asked currency', async () => {
  const usd = (amount: number) => ({ currency: 'USD', amount })
  await product({ name: 'Cheap in EUR', prices: [eur(500), usd(3000)] })
  await product({ name: 'Mid', prices: [eur(1500), usd(1500)] })
  await product({ name: 'Cheap in USD', prices: [eur(2500), usd(1000)] })
  await product({ name: 'EUR only', prices: [eur(2000)] })
  const order = async (input: object) => (await find(input)).items.map((i) => i.name)
  expect(await order({ sort: 'price-asc' })).toEqual([
    'Cheap in EUR',
    'Mid',
    'EUR only',
    'Cheap in USD',
  ])
  expect(await order({ sort: 'price-desc', currency: 'EUR' })).toEqual([
    'Cheap in USD',
    'EUR only',
    'Mid',
    'Cheap in EUR',
  ])
  // Without a price in the currency: last, either way.
  expect(await order({ sort: 'price-asc', currency: 'USD' })).toEqual([
    'Cheap in USD',
    'Mid',
    'Cheap in EUR',
    'EUR only',
  ])
  expect(await order({ sort: 'price-desc', currency: 'USD' })).toEqual([
    'Cheap in EUR',
    'Mid',
    'Cheap in USD',
    'EUR only',
  ])
  expect(await order({ sort: 'price-asc', price: { min: 1000, max: 2000 } })).toEqual([
    'Mid',
    'EUR only',
  ])
  expect(await order({ sort: 'price-asc', currency: 'USD', price: { max: 1500 } })).toEqual([
    'Cheap in USD',
    'Mid',
  ])
  // A configurable product sorts by its lowest enabled variant.
  await attribute('color', 'select', ['red', 'blue'])
  const tee = await product({
    name: 'Tee',
    type: 'configurable',
    prices: [eur(9000)],
    configurableAttributes: ['color'],
  })
  for (const [color, amount] of [
    ['red', 100],
    ['blue', 4000],
  ] as const) {
    output(
      await call('product-variant.create', {
        values: { productId: tee.id, sku: nextSku(), options: { color }, prices: [eur(amount)] },
      }),
    )
  }
  expect((await order({ sort: 'price-asc' }))[0]).toBe('Tee')
})

test('paging by cursor returns every match once', async () => {
  const usd = (amount: number) => ({ currency: 'USD', amount })
  for (let i = 0; i < 60; i++) {
    // Repeated prices and names, so ties are broken by id.
    await product({
      name: `Shirt ${String(i % 7)}`,
      prices: [eur(100 * (i % 5)), ...(i % 4 === 0 ? [] : [usd(i)])],
    })
  }
  for (const [sort, extra] of [
    ['relevance', { q: 'shirt' }],
    ['price-asc', {}],
    ['price-desc', {}],
    ['price-asc', { currency: 'USD' }],
    ['price-desc', { currency: 'USD' }],
    ['name', {}],
    ['newest', {}],
  ] as const) {
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page: Found = await find({ sort, ...extra, limit: 24, ...(cursor && { cursor }) })
      expect(page.total).toBe(60)
      seen.push(...page.items.map((i) => i.id))
      cursor = page.nextCursor
      pages++
    } while (cursor)
    expect(pages, sort).toBe(3)
    expect(new Set(seen).size, sort).toBe(60)
  }
  // A cursor from one sort is refused by another, and a made-up one too.
  const first = await find({ sort: 'name', limit: 24 })
  expect(
    failure(await call('search.query', { sort: 'newest', cursor: first.nextCursor }, guestActor))
      .code,
  ).toBe('invalid_input')
  for (const cursor of [
    'nope',
    Buffer.from('{"s":"newest","k":"x","id":"y"}').toString('base64url'),
  ]) {
    expect(failure(await call('search.query', { cursor }, guestActor)).code).toBe('invalid_input')
  }
})

test('suggest tolerates a typo', async () => {
  await product({ name: 'Shirt' })
  await product({ name: 'Trousers' })
  await product({ name: 'Hidden Shirt', status: 'draft' })
  const shirts = await category({ name: 'Shirts' })
  await category({ name: 'Shirt Accessories', enabled: false })
  await category({
    name: 'Shirts Inside',
    parentId: (await category({ name: 'Off', enabled: false })).id,
  })
  const typo = output<{
    products: { name: string; slug: string }[]
    categories: { id: string; name: string }[]
  }>(await call('search.suggest', { q: 'shrit' }, guestActor))
  expect(typo.products.map((p) => p.name)).toEqual(['Shirt'])
  expect(typo.products[0]?.slug).toBe('shirt')
  expect(typo.categories).toEqual([{ id: shirts.id, name: 'Shirts' }])
  const prefix = output<{ products: { name: string }[] }>(
    await call('search.suggest', { q: 'trou' }, guestActor),
  )
  expect(prefix.products.map((p) => p.name)).toEqual(['Trousers'])
})

test('Persian words are found', async () => {
  await product({ name: 'پیراهن آبی' })
  await product({ name: 'Blue Shirt', translations: { fa: { name: 'پیراهن سفید' } } })
  await product({ name: 'شلوار' })
  expect(await names({ q: 'پیراهن' })).toEqual(['Blue Shirt', 'پیراهن آبی'])
  expect((await find({ q: 'پیراهن', locale: 'fa' })).items.map((i) => i.name).sort()).toEqual([
    'پیراهن آبی',
    'پیراهن سفید',
  ])
  expect(await names({ q: 'پیرا' })).toEqual(['Blue Shirt', 'پیراهن آبی'])
  const suggested = output<{ products: { name: string }[] }>(
    await call('search.suggest', { q: 'شلوار' }, guestActor),
  )
  expect(suggested.products.map((p) => p.name)).toEqual(['شلوار'])
})

test('search survives hostile input', async () => {
  await attribute('color', 'select', ['red'])
  await product({ name: 'The Shirt' }, { color: 'red' })
  const hostile: [object, 'ok' | 'invalid_input'][] = [
    [{ q: '' }, 'ok'],
    [{ q: '   ' }, 'ok'],
    [{ q: 'the of and' }, 'ok'],
    [{ q: `"&|!:*()'` }, 'ok'],
    [{ q: `shirt & | ! : * ( ) ' "` }, 'ok'],
    [{ q: `shirt'` }, 'ok'],
    [{ q: `'shi` }, 'ok'],
    [{ q: 'ŉa' }, 'ok'],
    [{ q: '\\' }, 'ok'],
    [{ q: 'a\u0000b' }, 'invalid_input'],
    [{ filters: { color: ['\u0000'] } }, 'invalid_input'],
    [
      {
        sort: 'name',
        cursor: Buffer.from(
          JSON.stringify({ s: 'name', k: '\u0000', id: '00000000-0000-0000-0000-000000000000' }),
        ).toString('base64url'),
      },
      'invalid_input',
    ],
    [
      {
        sort: 'newest',
        cursor: Buffer.from(
          JSON.stringify({
            s: 'newest',
            k: '0000-13-45T00:00:00.000Z',
            id: '00000000-0000-0000-0000-000000000000',
          }),
        ).toString('base64url'),
      },
      'invalid_input',
    ],
    [{ q: 'x'.repeat(10_000) }, 'invalid_input'],
    [{ q: 'x'.repeat(200) }, 'ok'],
    [{ filters: { nope: ['x'] } }, 'invalid_input'],
    [{ filters: { color: [] } }, 'invalid_input'],
    [
      {
        filters: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`c${String(i)}`, ['x']])),
      },
      'invalid_input',
    ],
    [{ filters: { color: ["red' or 1=1 --"] } }, 'ok'],
    [{ limit: 10_000 }, 'invalid_input'],
    [{ limit: 0 }, 'invalid_input'],
    [{ price: { min: -1 } }, 'invalid_input'],
    [{ price: { min: 5000, max: 1 } }, 'ok'],
    [{ sort: 'random' }, 'invalid_input'],
    [{ categoryId: 'not-a-uuid' }, 'invalid_input'],
    [{ currency: 'eur' }, 'invalid_input'],
    [{ cursor: 'x'.repeat(5000) }, 'invalid_input'],
    [{ cursor: '!!!' }, 'invalid_input'],
  ]
  for (const [input, expected] of hostile) {
    const result = await call('search.query', input, guestActor)
    expect(result.ok ? 'ok' : result.error.code, JSON.stringify(input).slice(0, 80)).toBe(expected)
  }
  expect(await names({ q: 'the shirt' })).toEqual(['The Shirt'])
  for (const [q, expected] of [
    ['', 'invalid_input'],
    ['a', 'invalid_input'],
    ['x'.repeat(10_000), 'invalid_input'],
    [`"&|!:*()'`, 'ok'],
    ['the', 'ok'],
  ] as const) {
    const result = await call('search.suggest', { q }, guestActor)
    expect(result.ok ? 'ok' : result.error.code, q.slice(0, 20)).toBe(expected)
  }
})

test('a rolled-back product write leaves the index unchanged', async () => {
  await attribute('color', 'select', ['red'])
  const tee = await product({
    name: 'Tee',
    type: 'configurable',
    prices: [eur(1500)],
    configurableAttributes: ['color'],
  })
  output(
    await call('product-variant.create', {
      values: { productId: tee.id, sku: 'TAKEN', options: { color: 'red' } },
    }),
  )
  const other = await product({ name: 'Plain' })
  // The SKU is checked after the search wrap has indexed the new name, so the whole call rolls back.
  const result = await call('product.update', {
    id: other.id,
    version: 1,
    values: { name: 'Zebra', sku: 'TAKEN' },
  })
  expect(failure(result).code).toBe('conflict')
  expect((await find({ q: 'zebra' })).total).toBe(0)
  expect(await names({ q: 'plain' })).toEqual(['Plain'])
})

test('reindex rebuilds a wiped index', async () => {
  for (let i = 0; i < 3; i++) await product({ name: `Shirt ${String(i)}` })
  const gone = await product({ name: 'Ghost' })
  await database.client`truncate search_document`
  // A document whose product was deleted while search was off.
  await database.client`delete from catalog_product where id = ${gone.id}`
  await database.client`insert into search_document (product_id, status, name, created_at, tsv, suggest)
    values (${gone.id}, 'active', 'Ghost', now(), to_tsvector('ghost'), 'ghost')`
  expect((await find()).total).toBe(1)
  const queued = output<{ jobId: string; duplicate: boolean }>(await call('search.reindex', {}))
  expect(queued.duplicate).toBe(false)
  expect(output<{ duplicate: boolean }>(await call('search.reindex', {})).duplicate).toBe(true)
  await createWorker({ database, app, log: () => undefined }).runOnce()
  const [job] = await database.client`select status from job where id = ${queued.jobId}`
  expect(job?.status).toBe('done')
  expect(await names()).toEqual(['Shirt 0', 'Shirt 1', 'Shirt 2'])
  expect((await find()).total).toBe(3)
})

test('permission denied for search.reindex', async () => {
  const viewer: Actor = { type: 'admin', id: 'viewer', permissions: new Set(['catalog.read']) }
  expect(failure(await call('search.reindex', {}, viewer)).code).toBe('forbidden')
  expect(failure(await call('search.reindex', {}, guestActor)).code).toBe('forbidden')
  expect(failure(await call('search.reindex-page', {}, viewer)).code).toBe('forbidden')
  const [row] = await database.client`select count(*)::int as n from job`
  expect(row?.n).toBe(0)
})
