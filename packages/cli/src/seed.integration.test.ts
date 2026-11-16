import { randomBytes } from 'node:crypto'
import { guestActor, resolveModules, type Actor, type App } from '@aicommerce/core'
import { runMigrations } from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import { firstParty, migrationSources } from '@aicommerce/server'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { benchSearch, searchApp } from './commands/bench.js'
import { seedCatalog } from './commands/seed.js'

let database: TestDb
let app: App
const admin: Actor = { type: 'admin', id: 'admin-1', permissions: new Set(['*']) }

beforeAll(async () => {
  database = await createTestDb()
  const enabled = resolveModules(firstParty.modules, ['search']).enabled
  await runMigrations(database, migrationSources(enabled), { log: () => undefined })
  app = searchApp(database, firstParty.modules, enabled, randomBytes(32))
  await seedCatalog(database, 2000, () => undefined)
}, 120_000)
afterAll(async () => {
  await database.drop()
})

async function call<T>(name: string, input: object, actor: Actor = guestActor): Promise<T> {
  const result = await app.registry.call(name, input, { actor })
  if (!result.ok) throw new Error(`${name}: ${result.error.code}: ${result.error.message}`)
  return result.output as T
}
interface Found {
  items: { id: string; name: string; price: { amount: number } | null }[]
  total: number
  facets: { code: string; options: { value: string; count: number }[] }[]
}

test('seed writes a catalog that search finds, with facets and suggestions', async () => {
  const count = async (table: string): Promise<unknown> =>
    (await database.client`select count(*)::int as n from ${database.client(table)}`)[0]?.n
  expect(await count('catalog_product')).toBe(2000)
  expect(await count('catalog_product_variant')).toBe(800)
  expect(await count('catalog_category')).toBe(200)
  expect(await count('catalog_sku')).toBe(2800)
  expect(await count('search_document')).toBe(2000)

  const all = await call<Found>('search.query', { currency: 'EUR' })
  expect(all.total).toBe(1900)
  expect(all.items).toHaveLength(24)
  expect(all.items.every((i) => (i.price?.amount ?? 0) >= 500)).toBe(true)
  expect(all.facets.map((f) => f.code).sort()).toEqual([
    'brand',
    'color',
    'material',
    'pattern',
    'size',
  ])

  const [one] = await database.client`select id, name, attributes->>'brand' as brand
    from catalog_product where status = 'active' and type = 'configurable' order by sku limit 1`
  const id = String(one?.id)
  const byName = await call<Found>('search.query', {
    q: String(one?.name),
    filters: { brand: [String(one?.brand)] },
  })
  expect(byName.items.map((i) => i.id)).toContain(id)
  const suggested = await call<{ products: { id: string }[] }>('search.suggest', {
    q: String(one?.name),
  })
  expect(suggested.products.map((p) => p.id)).toContain(id)
})

test('seeded documents are what the search engine writes', async () => {
  const documents = () => database.client`select product_id, status, name, names, created_at,
    tsv::text, suggest, categories, facets, prices from search_document order by product_id`
  const words = () => database.client`select word from search_word order by word`
  const seeded = await documents()
  const seededWords = await words()
  // 30 adjectives, 12 colours, 8 materials and 50 nouns.
  expect(seededWords).toHaveLength(100)
  let after: string | null = null
  do {
    const page: { next: string | null } = await call(
      'search.reindex-page',
      after ? { after } : {},
      admin,
    )
    after = page.next
  } while (after)
  expect(await documents()).toEqual(seeded)
  expect(await words()).toEqual(seededWords)
})

test('seed refuses a catalog that is not empty', async () => {
  await expect(seedCatalog(database, 10, () => undefined)).rejects.toThrow('already has products')
})

test('bench runs every shape', async () => {
  const results = await benchSearch(app, database, 2, () => undefined)
  expect(results.map((r) => r.shape)).toEqual([
    'keyword',
    'keyword + 2 filters',
    'category, price sort',
    'category, page 5',
    'suggest',
  ])
})
