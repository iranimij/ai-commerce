// catalog.install-sample with search and seo on: they wrap the catalog, so this test lives here.
import { guestActor, settingStore, type Actor, type Result } from '@aicommerce/core'
import { shopCurrency } from '@aicommerce/module-setup'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createTestServer } from './testkit.js'

let t: Awaited<ReturnType<typeof createTestServer>>
const owner: Actor = { type: 'admin', id: 'owner-1', permissions: new Set(['*']) }

beforeAll(async () => {
  t = await createTestServer({
    modules: ['system', 'access', 'setup', 'media', 'catalog', 'search', 'seo'],
  })
  await t.app
    .service(settingStore)
    .write(shopCurrency, null, 'EUR', { action: 'test', actor: owner })
})
afterAll(async () => {
  await t.stop()
  await t.database.drop()
})

const call = (name: string, input: unknown, actor: Actor = owner) =>
  t.app.registry.call(name, input, { actor })

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function output<T>(result: Result<unknown>): T {
  if (!result.ok) throw new Error(`Expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.output as T
}

interface Tree {
  children: Tree[]
}
const count = (items: Tree[]): number => items.reduce((n, c) => n + 1 + count(c.children), 0)

test('install-sample refuses callers without catalog.manage, and unknown input', async () => {
  const editor: Actor = {
    type: 'admin',
    id: 'editor-1',
    permissions: new Set(['catalog.read', 'catalog.write', 'media.write', 'attribute.manage']),
  }
  for (const actor of [editor, guestActor]) {
    expect((await call('catalog.install-sample', {}, actor)).ok).toBe(false)
  }
  const denied = await call('catalog.install-sample', {}, editor)
  expect(!denied.ok && denied.error.code).toBe('forbidden')
  const invalid = await call('catalog.install-sample', { extra: 1 })
  expect(!invalid.ok && invalid.error.code).toBe('invalid_input')
})

test('install-sample creates a browsable catalog', async () => {
  const counts = output(await call('catalog.install-sample', {}))
  expect(counts).toEqual({
    attributes: 2,
    categories: 8,
    products: 36,
    variants: 38,
    images: 36,
  })

  const found = output<{ total: number; items: { slug: string; price: unknown }[] }>(
    await call('search.query', { limit: 48 }, guestActor),
  )
  expect(found.total).toBe(36)
  expect(found.items[0]?.price).toMatchObject({ currency: 'EUR' })
  const facets = output<{ facets: { code: string }[] }>(await call('search.query', {}, guestActor))
  expect(facets.facets.map((f) => f.code).sort()).toEqual(['color', 'size'])

  const slug = found.items[0]?.slug ?? ''
  expect(output(await call('seo.resolve', { path: `/${slug}` }, guestActor))).toMatchObject({
    kind: 'product',
  })
  const menu = output<{ items: Tree[] }>(await call('catalog.menu', {}, guestActor))
  expect(count(menu.items)).toBe(8)
  const fa = output<{ items: { name: string }[] }>(
    await call('catalog.menu', { locale: 'fa' }, guestActor),
  )
  expect(fa.items[0]?.name).toMatch(/[؀-ۿ]/)
  // 36 products, 38 variants and 36 images through actions: 4.8 s of the default 5 s on CI.
}, 30_000)

test('install-sample twice is a conflict', async () => {
  // The catalog from the test above is there.
  const again = await call('catalog.install-sample', {})
  expect(again.ok).toBe(false)
  expect(!again.ok && again.error).toMatchObject({
    code: 'conflict',
    message: 'Sample data is already installed',
  })
})
