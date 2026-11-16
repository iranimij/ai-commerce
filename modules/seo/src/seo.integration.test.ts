import {
  ActionError,
  attributeStore,
  createApp,
  createSettingsReader,
  defineModule,
  guestActor,
  jobs,
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
import { catalog, catalogMigrations } from '@aicommerce/module-catalog'
import { media, mediaMigrations } from '@aicommerce/module-media'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { seo, seoMigrations } from './index.js'

let database: TestDb
let app: ReturnType<typeof createApp>
const admin: Actor = { type: 'admin', id: 'admin-1', permissions: new Set(['*']) }
const editor: Actor = {
  type: 'admin',
  id: 'editor-1',
  permissions: new Set(['catalog.read', 'catalog.write', 'catalog.delete']),
}
const shop: Record<string, string> = {
  'shop.name': 'Acme',
  'shop.currency': 'EUR',
  'shop.language': 'en',
}

/** Fails a product rename to "boom" after everything inside it has run, so the call rolls back. */
const breaker = defineModule({
  name: 'breaker',
  depends: ['seo'],
  wraps: [
    {
      action: 'product.update',
      module: 'breaker',
      order: -10,
      wrap: async (input, _ctx, next) => {
        const out = await next(input)
        if ((input as { values: { slug?: string } }).values.slug === 'boom') {
          throw new ActionError('conflict', 'Stopped by the test')
        }
        return out
      },
    },
  ],
})

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(
    database,
    [coreMigrations, mediaMigrations, catalogMigrations, seoMigrations],
    {
      log: () => undefined,
    },
  )
  app = createApp({
    modules: [media, catalog, seo, breaker],
    enabled: ['media', 'catalog', 'seo', 'breaker'],
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
  await database.client`truncate catalog_category, catalog_product, catalog_product_variant,
    catalog_sku, seo_path, seo_redirect, job`
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

let serial = 0
const simple = (values: Record<string, unknown> = {}) => ({
  type: 'simple',
  sku: `SKU-${String(++serial)}`,
  name: 'Shirt',
  status: 'active',
  prices: [{ currency: 'EUR', amount: 1900 }],
  ...values,
})
const product = async (values: Record<string, unknown> = {}) =>
  output(await call('product.create', { values: simple(values) }))
const category = async (values: Record<string, unknown> = {}) =>
  output(await call('category.create', { values: { name: 'Shirts', ...values } }))
const update = async (
  resource: string,
  record: ResourceRecord,
  values: Record<string, unknown>,
  actor: Actor = admin,
) => call(`${resource}.update`, { id: record.id, version: record.version, values }, actor)
const rename = async (record: ResourceRecord, slug: string) =>
  output(await update('product', record, { slug }))

const resolve = async (path: string) =>
  output<unknown>(await call('seo.resolve', { path }, guestActor))
const missing = async (path: string) =>
  failure(await call('seo.resolve', { path }, guestActor)).code
const redirects = async () =>
  output<{ items: ResourceRecord[] }>(await call('redirect.list', { limit: 100 }))
    .items.map((r) => [r.from, r.to, r.status, r.auto])
    .sort()

describe('paths', () => {
  test('resolve finds products and categories', async () => {
    const shirt = await product({ name: 'Blue Shirt' })
    const men = await category({ name: 'Men' })
    const shirts = await category({ name: 'Shirts', parentId: men.id })
    const persian = await product({ name: 'پیراهن آبی' })

    expect(await resolve('/blue-shirt')).toEqual({ kind: 'product', id: shirt.id })
    expect(await resolve('/men')).toEqual({ kind: 'category', id: men.id })
    expect(await resolve('/men/shirts')).toEqual({ kind: 'category', id: shirts.id })
    // As typed, and percent-encoded as a browser sends it.
    expect(await resolve('/پیراهن-آبی')).toEqual({ kind: 'product', id: persian.id })
    expect(await resolve(encodeURI('/پیراهن-آبی'))).toEqual({ kind: 'product', id: persian.id })

    expect(await missing('/nothing')).toBe('not_found')
    expect(await missing('/shirts')).toBe('not_found')
    expect(await missing('/%E0%A4%A')).toBe('not_found')
    expect(failure(await call('seo.resolve', { path: '' }, guestActor)).code).toBe('invalid_input')
  })

  test('renames redirect in one hop', async () => {
    let p = await product({ slug: 'a' })
    p = await rename(p, 'b')
    p = await rename(p, 'c')

    expect(await resolve('/a')).toEqual({ kind: 'redirect', to: '/c', status: 301 })
    expect(await resolve('/b')).toEqual({ kind: 'redirect', to: '/c', status: 301 })
    expect(await resolve('/c')).toEqual({ kind: 'product', id: p.id })
    expect(await redirects()).toEqual([
      ['/a', '/c', 301, true],
      ['/b', '/c', 301, true],
    ])
    // A rename without a slug change moves nothing.
    output(await update('product', p, { name: 'Other name' }))
    expect(await resolve('/c')).toEqual({ kind: 'product', id: p.id })
    expect(await redirects()).toHaveLength(2)
  })

  test('renaming back removes the redirect', async () => {
    let p = await product({ slug: 'a' })
    p = await rename(p, 'b')
    p = await rename(p, 'a')

    expect(await resolve('/a')).toEqual({ kind: 'product', id: p.id })
    expect(await resolve('/b')).toEqual({ kind: 'redirect', to: '/a', status: 301 })
    expect(await redirects()).toEqual([['/b', '/a', 301, true]])
  })

  test('a category rename moves its subcategories', async () => {
    const men = await category({ name: 'Men' })
    const shirts = await category({ name: 'Shirts', parentId: men.id })
    const linen = await category({ name: 'Linen', parentId: shirts.id })

    output(await update('category', men, { slug: 'mens' }))
    expect(await resolve('/mens')).toEqual({ kind: 'category', id: men.id })
    expect(await resolve('/mens/shirts/linen')).toEqual({ kind: 'category', id: linen.id })
    expect(await resolve('/men')).toEqual({ kind: 'redirect', to: '/mens', status: 301 })
    expect(await resolve('/men/shirts/linen')).toEqual({
      kind: 'redirect',
      to: '/mens/shirts/linen',
      status: 301,
    })

    // A move to another parent moves the subtree too, and the older redirects follow in one hop.
    const women = await category({ name: 'Women' })
    output(await update('category', shirts, { parentId: women.id }))
    expect(await resolve('/women/shirts/linen')).toEqual({ kind: 'category', id: linen.id })
    expect(await resolve('/men/shirts/linen')).toEqual({
      kind: 'redirect',
      to: '/women/shirts/linen',
      status: 301,
    })
    expect(await resolve('/mens/shirts')).toEqual({
      kind: 'redirect',
      to: '/women/shirts',
      status: 301,
    })
    // /men/shirts and /women/shirts may coexist: slugs are unique per parent.
    const menShirts = await category({ name: 'Shirts', parentId: men.id })
    expect(await resolve('/mens/shirts')).toEqual({ kind: 'category', id: menShirts.id })
  })

  test('a taken or reserved path is a conflict', async () => {
    await category({ name: 'Shirts' })
    const taken = failure(await call('product.create', { values: simple({ slug: 'shirts' }) }))
    expect(taken.code).toBe('conflict')
    expect(taken.message).toContain('Shirts')

    const tee = await product({ name: 'Tee', slug: 'tee' })
    const byProduct = failure(
      await call('category.create', { values: { name: 'Tees', slug: 'tee' } }),
    )
    expect(byProduct.code).toBe('conflict')
    expect(byProduct.message).toContain('Tee')

    // Renaming into a taken path changes nothing.
    expect(failure(await update('product', tee, { slug: 'shirts' })).code).toBe('conflict')
    expect(await resolve('/tee')).toEqual({ kind: 'product', id: tee.id })
    expect(await redirects()).toEqual([])

    expect(failure(await call('product.create', { values: simple({ slug: 'search' }) })).code).toBe(
      'conflict',
    )
    // A generated slug is checked too.
    expect(failure(await call('category.create', { values: { name: 'Cart' } })).code).toBe(
      'conflict',
    )
    // Only the first segment is reserved.
    const men = await category({ name: 'Men' })
    const sub = await category({ name: 'Search', parentId: men.id })
    expect(await resolve('/men/search')).toEqual({ kind: 'category', id: sub.id })
    // A draft has no live path, so it holds nothing until it is published.
    const draft = await product({ slug: 'checkout', status: 'draft' })
    expect(failure(await update('product', draft, { status: 'active' })).code).toBe('conflict')
  })

  test('drafts and disabled categories have no live path', async () => {
    let draft = await product({ slug: 'later', status: 'draft' })
    expect(await missing('/later')).toBe('not_found')
    draft = output(await update('product', draft, { status: 'active' }))
    expect(await resolve('/later')).toEqual({ kind: 'product', id: draft.id })
    output(await update('product', draft, { status: 'archived' }))
    expect(await missing('/later')).toBe('not_found')

    const hidden = await category({ name: 'Hidden', enabled: false })
    expect(await missing('/hidden')).toBe('not_found')
    const top = await category({ name: 'Top' })
    const sub = await category({ name: 'Sub', parentId: top.id })
    const off = output(await update('category', top, { enabled: false }))
    expect(await missing('/top')).toBe('not_found')
    expect(await missing('/top/sub')).toBe('not_found')
    output(await update('category', off, { enabled: true }))
    expect(await resolve('/top/sub')).toEqual({ kind: 'category', id: sub.id })
    // Going out of sight is not a move: no redirects.
    expect(await redirects()).toEqual([])

    const gone = await product({ slug: 'gone' })
    output(await call('product.delete', { id: gone.id, version: gone.version }))
    expect(await missing('/gone')).toBe('not_found')
    output(await call('category.delete', { id: hidden.id, version: hidden.version }))
  })

  test('a rolled-back rename changes nothing', async () => {
    const p = await product({ slug: 'kept' })
    expect(failure(await update('product', p, { slug: 'boom' })).message).toBe(
      'Stopped by the test',
    )
    expect(await resolve('/kept')).toEqual({ kind: 'product', id: p.id })
    expect(await missing('/boom')).toBe('not_found')
    expect(await redirects()).toEqual([])
  })

  test('rebuild restores the paths', async () => {
    const shirt = await product({ slug: 'shirt' })
    await product({ slug: 'draft', status: 'draft' })
    const men = await category({ name: 'Men' })
    const shirts = await category({ name: 'Shirts', parentId: men.id })
    // As if seo had been off while the catalog changed.
    await database.client`truncate seo_path`
    expect(await missing('/shirt')).toBe('not_found')

    expect(failure(await call('seo.rebuild', {}, editor)).code).toBe('forbidden')
    output(await call('seo.rebuild', {}))
    await createWorker({ database, app, log: () => undefined }).runOnce()

    expect(await resolve('/shirt')).toEqual({ kind: 'product', id: shirt.id })
    expect(await resolve('/men/shirts')).toEqual({ kind: 'category', id: shirts.id })
    expect(await missing('/draft')).toBe('not_found')
  })
})

describe('redirects', () => {
  test('a redirect must point to a path on this shop', async () => {
    for (const to of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'evil.example',
      'javascript:alert(1)',
      '/next\r\nSet-Cookie: x=1',
    ]) {
      const error = failure(await call('redirect.create', { values: { from: '/old', to } }))
      expect(error.code, to).toBe('invalid_input')
    }
    expect(
      failure(await call('redirect.create', { values: { from: '//old', to: '/new' } })).code,
    ).toBe('invalid_input')

    const made = output(await call('redirect.create', { values: { from: '/old', to: '/new' } }))
    expect(made).toMatchObject({ from: '/old', to: '/new', status: 301, auto: false })
    expect(await resolve('/old')).toEqual({ kind: 'redirect', to: '/new', status: 301 })

    // Never a loop, never two hops.
    expect(
      failure(await call('redirect.create', { values: { from: '/same', to: '/same' } })).code,
    ).toBe('invalid_input')
    expect(
      failure(await call('redirect.create', { values: { from: '/new', to: '/old' } })).code,
    ).toBe('invalid_input')
    output(await call('redirect.create', { values: { from: '/older', to: '/old', status: 302 } }))
    expect(await resolve('/older')).toEqual({ kind: 'redirect', to: '/new', status: 302 })
    // A live page is not redirected.
    await product({ slug: 'live' })
    expect(
      failure(await call('redirect.create', { values: { from: '/live', to: '/new' } })).code,
    ).toBe('conflict')
  })

  test('redirects need seo.write', async () => {
    const values = { from: '/x', to: '/y' }
    expect(failure(await call('redirect.create', { values }, editor)).code).toBe('forbidden')
    expect(failure(await call('redirect.create', { values }, guestActor)).code).toBe('forbidden')
    // A rename writes a redirect as the same caller, so it needs seo.write too.
    const p = await product({ slug: 'p1' })
    expect(failure(await update('product', p, { slug: 'p2' }, editor)).code).toBe('forbidden')
    expect(await resolve('/p1')).toEqual({ kind: 'product', id: p.id })
  })
})

describe('meta and sitemap', () => {
  test('meta gives the title, description and canonical path', async () => {
    const p = await product({
      name: 'Blue Shirt',
      shortDescription: '**Soft** cotton, cut [slim](/fit).',
    })
    expect(output(await call('seo.meta', { kind: 'product', id: p.id }, guestActor))).toEqual({
      title: 'Blue Shirt | Acme',
      description: 'Soft cotton, cut slim.',
      canonical: '/blue-shirt',
      robots: 'index, follow',
    })
    const own = await product({ name: 'Tee', metaTitle: 'Best tee', metaDescription: 'Buy it.' })
    expect(output(await call('seo.meta', { kind: 'product', id: own.id }))).toMatchObject({
      title: 'Best tee | Acme',
      description: 'Buy it.',
    })
    const men = await category({ name: 'Men' })
    const shirts = await category({ name: 'Shirts', parentId: men.id, description: 'All shirts' })
    expect(output(await call('seo.meta', { kind: 'category', id: shirts.id }))).toEqual({
      title: 'Shirts | Acme',
      description: 'All shirts',
      canonical: '/men/shirts',
      robots: 'index, follow',
    })

    const draft = await product({ slug: 'draft', status: 'draft' })
    expect(failure(await call('seo.meta', { kind: 'product', id: draft.id })).code).toBe(
      'not_found',
    )
    expect(failure(await call('seo.meta', { kind: 'page', id: p.id })).code).toBe('invalid_input')
  })

  test('sitemap pages hold at most 50,000 URLs', async () => {
    for (const slug of ['d', 'b', 'a', 'c', 'e']) await product({ slug })
    await product({ slug: 'hidden', status: 'draft' })
    await category({ name: 'Zed' })

    type Sitemap = { urls: { loc: string; lastmod: string }[]; pages: number }
    const page = async (input: object) =>
      output<Sitemap>(await call('seo.sitemap', input, guestActor))
    const first = await page({ page: 1, size: 2 })
    expect(first.pages).toBe(3)
    expect(first.urls.map((u) => u.loc)).toEqual(['/a', '/b'])
    expect(new Date(first.urls[0]?.lastmod ?? '').getTime()).not.toBeNaN()
    expect((await page({ page: 3, size: 2 })).urls.map((u) => u.loc)).toEqual(['/e', '/zed'])
    expect((await page({ page: 4, size: 2 })).urls).toEqual([])

    const all = await page({})
    expect(all.pages).toBe(1)
    expect(all.urls).toHaveLength(6)
    for (const input of [{ size: 50_001 }, { page: 0 }]) {
      expect(failure(await call('seo.sitemap', input, guestActor)).code).toBe('invalid_input')
    }
  })
})
