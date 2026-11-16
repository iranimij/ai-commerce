import { randomUUID } from 'node:crypto'
import {
  attributeInput,
  attributeStore,
  createApp,
  createSettingsReader,
  guestActor,
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
  createPgResourceStore,
  databaseService,
  runMigrations,
} from '@aicommerce/db'
import { createTestDb, type TestDb } from '@aicommerce/db/testing'
import { media, mediaMigrations } from '@aicommerce/module-media'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { catalog, catalogMigrations, type ProductView } from './index.js'

let database: TestDb
let app: ReturnType<typeof createApp>
const admin: Actor = { type: 'admin', id: 'admin-1', permissions: new Set(['*']) }
const shop: Record<string, string> = { 'shop.currency': 'EUR', 'shop.language': 'en' }

beforeAll(async () => {
  database = await createTestDb()
  await runMigrations(database, [coreMigrations, mediaMigrations, catalogMigrations], {
    log: () => undefined,
  })
  app = createApp({
    modules: [media, catalog],
    enabled: ['media', 'catalog'],
    services: [
      provide(resourceStore, 'app', createPgResourceStore(database)),
      provide(attributeStore, 'app', createPgAttributeStore(database)),
      provide(databaseService, 'app', database),
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
    catalog_product_variant, catalog_sku, media_media_file, attribute`
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
const configurable = (values: Record<string, unknown> = {}, attributes?: object) =>
  product(
    { type: 'configurable', prices: [], configurableAttributes: ['color'], ...values },
    attributes,
  )
const variant = async (productId: string, values: Record<string, unknown> = {}) =>
  output(
    await call('product-variant.create', {
      values: { productId, sku: nextSku(), options: { color: 'red' }, ...values },
    }),
  )
const category = async (values: Record<string, unknown> = {}) =>
  output(await call('category.create', { values: { name: 'Shirts', ...values } }))

/** A media file row, as media.upload would leave it. */
async function file(alt?: string): Promise<string> {
  const id = randomUUID()
  await database.client`insert into media_media_file
    (id, version, created_at, updated_at, filename, content_type, width, height, bytes, sha256, alt)
    values (${id}, 1, now(), now(), 'a.png', 'image/webp', 800, 600, 100,
      ${id.replaceAll('-', '').padEnd(64, '0')}, ${alt ?? null})`
  return id
}

/** A public merchant select attribute on product. */
async function select(code: string, options: string[], extra: object = {}) {
  await app.service(attributeStore).create(
    merchantAttribute(
      attributeInput.parse({
        resource: 'product',
        code,
        label: code.charAt(0).toUpperCase() + code.slice(1),
        type: 'select',
        options,
        privacy: 'public',
        ...extra,
      }),
    ),
  )
}

const view = async (id: string, extra: object = {}) =>
  output<ProductView>(await call('catalog.product-view', { id, ...extra }, guestActor))

test('create, update, delete and restore a product, with revisions', async () => {
  const created = await product({ name: 'Blue Shirt', status: 'draft' })
  expect(created).toMatchObject({ slug: 'blue-shirt', status: 'draft', categoryIds: [], media: [] })
  const updated = output(
    await call('product.update', {
      id: created.id,
      version: 1,
      values: { name: 'Navy Shirt', status: 'active' },
    }),
  )
  // The slug stays until it is changed: a rename never moves a URL by itself.
  expect(updated).toMatchObject({ name: 'Navy Shirt', slug: 'blue-shirt', version: 2 })
  output(await call('product.delete', { id: created.id, version: 2 }))
  expect(failure(await call('product.get', { id: created.id })).code).toBe('not_found')

  const history = output<{ items: { id: string; version: number | null }[] }>(
    await call('product.history', { id: created.id }),
  )
  expect(history.items.map((r) => r.version)).toEqual([null, 2, 1])
  const restored = output(await call('product.restore', { revisionId: history.items[1]?.id }))
  expect(restored).toMatchObject({ id: created.id, name: 'Navy Shirt', version: 3 })
  // The SKU came back with it.
  expect(
    failure(
      await call('product.create', {
        values: { type: 'simple', sku: created.sku, name: 'X', prices: [eur(1)] },
      }),
    ).code,
  ).toBe('conflict')
})

test('a duplicate slug gets a suffix', async () => {
  expect((await product({ name: 'Blue Shirt' })).slug).toBe('blue-shirt')
  expect((await product({ name: 'Blue shirt!' })).slug).toBe('blue-shirt-2')
  expect((await product({ name: 'BLUE SHIRT' })).slug).toBe('blue-shirt-3')
  expect((await product({ name: 'پیراهن آبی' })).slug).toBe('پیراهن-آبی')
  // A slug given on purpose is not changed: taken is a conflict.
  const taken = failure(
    await call('product.create', {
      values: { type: 'simple', sku: nextSku(), name: 'X', slug: 'blue-shirt', prices: [eur(1)] },
    }),
  )
  expect(taken).toMatchObject({
    code: 'conflict',
    message: 'Product with this slug already exists',
  })
  expect(
    failure(
      await call('product.create', {
        values: { type: 'simple', sku: nextSku(), name: 'X', slug: 'Not A Slug', prices: [eur(1)] },
      }),
    ).code,
  ).toBe('invalid_input')
  // Categories: per parent.
  const shirts = await category({ name: 'Shirts' })
  expect((await category({ name: 'Shirts' })).slug).toBe('shirts-2')
  expect((await category({ name: 'Shirts', parentId: shirts.id })).slug).toBe('shirts')
})

test('a duplicate SKU is a conflict, across products and variants', async () => {
  await select('color', ['red', 'blue'])
  const parent = await configurable({ sku: 'TEE' })
  const conflict = {
    code: 'conflict',
    message: 'A product or variant with this SKU already exists',
  }
  expect(
    failure(
      await call('product.create', {
        values: { type: 'simple', sku: 'TEE', name: 'X', prices: [eur(1)] },
      }),
    ),
  ).toMatchObject({ code: 'conflict' })
  expect(
    failure(
      await call('product-variant.create', {
        values: { productId: parent.id, sku: 'TEE', options: { color: 'red' } },
      }),
    ),
  ).toMatchObject(conflict)
  const red = await variant(parent.id, { sku: 'TEE-RED' })
  expect(
    failure(
      await call('product.create', {
        values: { type: 'simple', sku: 'TEE-RED', name: 'X', prices: [eur(1)] },
      }),
    ),
  ).toMatchObject(conflict)
  // A changed SKU frees the old one.
  output(await call('product-variant.update', { id: red.id, version: 1, values: { sku: 'TEE-R' } }))
  await product({ sku: 'TEE-RED' })
  expect(
    failure(await call('product.update', { id: parent.id, version: 1, values: { sku: 'TEE-R' } })),
  ).toMatchObject(conflict)
})

test('a simple product needs a price', async () => {
  const error = failure(
    await call('product.create', {
      values: { type: 'simple', sku: nextSku(), name: 'X', prices: [] },
    }),
  )
  expect(error.code).toBe('invalid_input')
  expect(error.issues?.[0]?.path).toEqual(['values', 'prices'])
  const twice = failure(
    await call('product.create', {
      values: { type: 'simple', sku: nextSku(), name: 'X', prices: [eur(1), eur(2)] },
    }),
  )
  expect(twice.code).toBe('invalid_input')
  // Other currencies and channels are fine.
  await product({
    prices: [
      eur(1),
      { currency: 'USD', amount: 2 },
      { currency: 'EUR', amount: 3, channel: 'b2b' },
    ],
  })
  const one = await product()
  expect(
    failure(await call('product.update', { id: one.id, version: 1, values: { prices: [] } })).code,
  ).toBe('invalid_input')
})

test('a configurable product needs select attributes', async () => {
  await select('color', ['red'])
  await app.service(attributeStore).create(
    merchantAttribute(
      attributeInput.parse({
        resource: 'product',
        code: 'fabric',
        label: 'Fabric',
        type: 'text',
      }),
    ),
  )
  const base = { type: 'configurable', sku: nextSku(), name: 'X', prices: [] }
  const missing = failure(await call('product.create', { values: base }))
  expect(missing).toMatchObject({ code: 'invalid_input' })
  expect(missing.issues?.[0]?.path).toEqual(['values', 'configurableAttributes'])
  for (const codes of [['fabric'], ['nope'], [], ['color', 'color']]) {
    expect(
      failure(await call('product.create', { values: { ...base, configurableAttributes: codes } }))
        .code,
    ).toBe('invalid_input')
  }
  const simple = failure(
    await call('product.create', {
      values: {
        type: 'simple',
        sku: nextSku(),
        name: 'X',
        prices: [eur(1)],
        configurableAttributes: ['color'],
      },
    }),
  )
  expect(simple.code).toBe('invalid_input')
  await select('size', ['s'])
  const ok = await configurable()
  expect(
    failure(await call('product.update', { id: ok.id, version: 1, values: { type: 'simple' } }))
      .code,
  ).toBe('invalid_input')
  await variant(ok.id)
  // With variants, the axes cannot change.
  expect(
    failure(
      await call('product.update', {
        id: ok.id,
        version: 1,
        values: { configurableAttributes: ['color', 'size'] },
      }),
    ).code,
  ).toBe('conflict')
})

test('variants must give the parent options, once each', async () => {
  await select('color', ['red', 'blue'])
  await select('size', ['s', 'm'])
  const parent = await configurable({ configurableAttributes: ['color', 'size'] })
  await variant(parent.id, { options: { color: 'red', size: 's' } })
  const bad = [
    { color: 'red' },
    { color: 'red', size: 's', fit: 'x' },
    { color: 'green', size: 's' },
  ]
  for (const options of bad) {
    expect(
      failure(
        await call('product-variant.create', {
          values: { productId: parent.id, sku: nextSku(), options },
        }),
      ).code,
    ).toBe('invalid_input')
  }
  const again = failure(
    await call('product-variant.create', {
      values: { productId: parent.id, sku: nextSku(), options: { size: 's', color: 'red' } },
    }),
  )
  expect(again.code).toBe('conflict')
  const simple = await product()
  expect(
    failure(
      await call('product-variant.create', {
        values: { productId: simple.id, sku: nextSku(), options: { color: 'red' } },
      }),
    ).code,
  ).toBe('invalid_input')
  expect(
    failure(
      await call('product-variant.create', {
        values: { productId: randomUUID(), sku: nextSku(), options: { color: 'red' } },
      }),
    ).code,
  ).toBe('invalid_input')
})

test('references must exist', async () => {
  const gone = randomUUID()
  const cases = [
    { categoryIds: [gone] },
    { media: [{ kind: 'image', file: gone }] },
    { links: [{ kind: 'related', product: gone }] },
    { attributeSetId: gone },
  ]
  for (const values of cases) {
    const error = failure(
      await call('product.create', {
        values: { type: 'simple', sku: nextSku(), name: 'X', prices: [eur(1)], ...values },
      }),
    )
    expect(error.code).toBe('invalid_input')
    expect(error.issues?.[0]?.path[1]).toBe(Object.keys(values)[0])
  }
  const self = await product()
  expect(
    failure(
      await call('product.update', {
        id: self.id,
        version: 1,
        values: { links: [{ kind: 'related', product: self.id }] },
      }),
    ).code,
  ).toBe('invalid_input')
  // And they work when they do.
  const set = output(
    await call('attribute-set.create', { values: { name: 'Clothing', codes: [] } }),
  )
  await product({
    categoryIds: [(await category()).id],
    media: [
      { kind: 'image', file: await file() },
      { kind: 'video', url: 'https://youtu.be/abc' },
    ],
    links: [{ kind: 'upsell', product: self.id }],
    attributeSetId: set.id,
  })
  expect(
    failure(
      await call('product.create', {
        values: {
          type: 'simple',
          sku: nextSku(),
          name: 'X',
          prices: [eur(1)],
          media: [{ kind: 'video', url: 'https://evil.example/x' }],
        },
      }),
    ).code,
  ).toBe('invalid_input')
  expect(
    failure(await call('attribute-set.create', { values: { name: 'Other', codes: ['nope'] } }))
      .code,
  ).toBe('invalid_input')
})

test('a category cannot be its own ancestor', async () => {
  const a = await category({ name: 'A' })
  const b = await category({ name: 'B', parentId: a.id })
  const c = await category({ name: 'C', parentId: b.id })
  for (const parentId of [a.id, c.id]) {
    const error = failure(
      await call('category.update', { id: a.id, version: 1, values: { parentId } }),
    )
    expect(error).toMatchObject({
      code: 'invalid_input',
      message: 'A category cannot be its own ancestor',
    })
  }
  // Moving to the top level is null.
  expect(
    output(await call('category.update', { id: c.id, version: 1, values: { parentId: null } }))
      .parentId,
  ).toBeUndefined()
  expect(
    failure(await call('category.create', { values: { name: 'D', parentId: randomUUID() } })).code,
  ).toBe('invalid_input')
})

test('a category with products cannot be deleted', async () => {
  const parent = await category({ name: 'Clothes' })
  const child = await category({ name: 'Shirts', parentId: parent.id })
  await product({ categoryIds: [child.id] })
  await product({ categoryIds: [child.id], status: 'draft' })
  expect(failure(await call('category.delete', { id: parent.id, version: 1 }))).toMatchObject({
    code: 'conflict',
    message: 'This category has 1 subcategory; move or delete it first',
  })
  expect(failure(await call('category.delete', { id: child.id, version: 1 }))).toMatchObject({
    code: 'conflict',
    message: 'This category has 2 products; move or delete them first',
  })
  const empty = await category({ name: 'Empty' })
  output(await call('category.delete', { id: empty.id, version: 1 }))
})

test('deleting a product deletes its variants with revisions', async () => {
  await select('color', ['red', 'blue'])
  const parent = await configurable()
  const red = await variant(parent.id, { options: { color: 'red' } })
  const blue = await variant(parent.id, { options: { color: 'blue' } })
  output(await call('product.delete', { id: parent.id, version: 1 }))
  for (const v of [red, blue]) {
    expect(failure(await call('product-variant.get', { id: v.id })).code).toBe('not_found')
    const history = output<{ items: { version: number | null; action: string }[] }>(
      await call('product-variant.history', { id: v.id }),
    )
    expect(history.items[0]).toMatchObject({ version: null, action: 'product-variant.delete' })
  }
  // Their SKUs are free again.
  await product({ sku: red.sku })
  const audit = await database.client`select action from audit_log
    where action like '%.delete' order by id desc limit 3`
  expect(audit.map((r) => String(r.action)).reverse()).toEqual([
    'product-variant.delete',
    'product-variant.delete',
    'product.delete',
  ])
})

describe('the public views', () => {
  test('product-view hides drafts and archived products', async () => {
    for (const status of ['draft', 'archived']) {
      const hidden = await product({ status })
      expect(failure(await call('catalog.product-view', { id: hidden.id }, guestActor)).code).toBe(
        'not_found',
      )
    }
    expect(failure(await call('catalog.product-view', { id: randomUUID() }, guestActor)).code).toBe(
      'not_found',
    )
    const shown = await product({ name: 'Shown', shortDescription: 'Soft' })
    expect(await view(shown.id)).toMatchObject({
      name: 'Shown',
      shortDescription: 'Soft',
      price: { amount: 1000, currency: 'EUR', from: false },
    })
  })

  test('product-view gives the lowest variant price as from', async () => {
    await select('color', ['red', 'blue', 'green'])
    const parent = await configurable({ prices: [eur(3000), { currency: 'USD', amount: 3300 }] })
    await variant(parent.id, { options: { color: 'red' } })
    await variant(parent.id, {
      options: { color: 'blue' },
      prices: [{ currency: 'EUR', amount: 2500, compareAt: 2900 }],
    })
    await variant(parent.id, { options: { color: 'green' }, prices: [eur(100)], enabled: false })
    const shown = await view(parent.id)
    expect(shown.price).toEqual({ amount: 2500, currency: 'EUR', compareAt: 2900, from: true })
    expect(shown.variants.map((v) => v.options.color)).toEqual(['red', 'blue'])
    expect(shown.variants[0]?.price).toMatchObject({ amount: 3000 })
    // In another currency, only what has a price in it.
    expect((await view(parent.id, { currency: 'USD' })).price).toEqual({
      amount: 3300,
      currency: 'USD',
      from: false,
    })
    expect((await view(parent.id, { currency: 'GBP' })).price).toBeNull()
  })

  test('product-view localizes with a fallback', async () => {
    shop['shop.language'] = 'fa'
    try {
      const shown = await product({
        name: 'Shirt',
        description: 'Cotton',
        translations: { de: { name: 'Hemd' }, fa: { name: 'پیراهن', description: 'نخی' } },
      })
      // German name, the shop language's description:
      expect(await view(shown.id, { locale: 'de' })).toMatchObject({
        name: 'Hemd',
        description: 'نخی',
      })
      expect(await view(shown.id)).toMatchObject({ name: 'پیراهن', description: 'نخی' })
      expect(await view(shown.id, { locale: 'it' })).toMatchObject({ name: 'پیراهن' })
      expect(await view(shown.id, { locale: 'de' })).not.toHaveProperty('translations')
    } finally {
      shop['shop.language'] = 'en'
    }
  })

  test('product-view skips what no longer exists', async () => {
    const kept = await file('Front')
    const deleted = await file()
    const swatch = await file()
    await select('color', ['red', 'blue'], {
      swatches: { red: { color: '#ff0000' }, blue: { file: swatch } },
    })
    await select('fit', ['slim'])
    await app.service(attributeStore).create(
      merchantAttribute(
        attributeInput.parse({
          resource: 'product',
          code: 'fabric',
          label: 'Fabric',
          type: 'text',
          privacy: 'public',
        }),
      ),
    )
    await app.service(attributeStore).create(
      merchantAttribute(
        attributeInput.parse({
          resource: 'product',
          code: 'cost',
          label: 'Cost',
          type: 'number',
          privacy: 'internal',
        }),
      ),
    )
    const set = output(
      await call('attribute-set.create', {
        values: { name: 'Clothing', codes: ['fabric', 'cost', 'fit'] },
      }),
    ).id
    const top = await category({ name: 'Clothes' })
    const off = await category({ name: 'Old', enabled: false })
    const shirts = await category({ name: 'Shirts', parentId: top.id })
    const parent = await configurable(
      {
        configurableAttributes: ['color', 'fit'],
        media: [
          { kind: 'image', file: deleted },
          { kind: 'image', file: kept },
          { kind: 'video', url: 'https://vimeo.com/1' },
        ],
        categoryIds: [off.id, shirts.id],
        attributeSetId: set,
      },
      { fabric: 'Linen', cost: 12, fit: 'slim' },
    )
    expect((await view(parent.id)).specifications.map((s) => s.code)).toEqual(['fabric', 'fit'])
    await variant(parent.id, { options: { color: 'red', fit: 'slim' }, prices: [eur(1000)] })
    await variant(parent.id, {
      options: { color: 'blue', fit: 'slim' },
      prices: [eur(1200)],
      media: [{ kind: 'image', file: deleted }],
    })
    // What goes away after the product was saved:
    await database.client`delete from media_media_file where id in (${deleted}, ${swatch})`
    await app.service(attributeStore).delete('product', 'fit')

    const shown = await view(parent.id)
    expect(shown.media).toEqual([
      {
        kind: 'image',
        id: kept,
        url: `/api/media/${kept}/1280`,
        alt: 'Front',
        width: 800,
        height: 600,
      },
      { kind: 'video', url: 'https://vimeo.com/1' },
    ])
    expect(shown.options).toEqual([
      {
        code: 'color',
        label: 'Color',
        values: [{ value: 'red', swatch: { color: '#ff0000' } }, { value: 'blue' }],
      },
    ])
    expect(shown.variants.map((v) => v.options)).toEqual([{ color: 'red' }, { color: 'blue' }])
    expect(shown.variants[1]?.media).toEqual([])
    expect(shown.breadcrumbs.map((c) => c.name)).toEqual(['Clothes', 'Shirts'])
    // Internal attributes are never public.
    expect(shown.specifications).toEqual([{ code: 'fabric', label: 'Fabric', value: 'Linen' }])
    // The attribute set itself gone, and the path's top disabled:
    await database.client`delete from catalog_attribute_set`
    await database.client`update catalog_category set enabled = false where id = ${top.id}`
    const again = await view(parent.id)
    expect(again.breadcrumbs).toEqual([])
    expect(again.specifications).toEqual([{ code: 'fabric', label: 'Fabric', value: 'Linen' }])
  })

  test('related falls back to the same category', async () => {
    const shirts = await category()
    const front = await file('A front')
    const a = await product({
      name: 'A',
      categoryIds: [shirts.id],
      media: [{ kind: 'image', file: front }],
    })
    const b = await product({ name: 'B', categoryIds: [shirts.id] })
    await product({ name: 'Draft', categoryIds: [shirts.id], status: 'draft' })
    const c = await product({ name: 'C', categoryIds: [shirts.id] })
    const related = (await view(c.id)).related
    expect(related.map((p) => p.name).sort()).toEqual(['A', 'B'])
    expect(related.find((p) => p.id === a.id)).toEqual({
      id: a.id,
      slug: 'a',
      name: 'A',
      price: { amount: 1000, currency: 'EUR', from: false },
      image: { url: `/api/media/${front}/640`, alt: 'A front' },
    })
    // Hand-picked links win, in their order, and only active ones show.
    const linked = output(
      await call('product.update', {
        id: c.id,
        version: 1,
        values: {
          links: [
            { kind: 'related', product: b.id },
            { kind: 'upsell', product: a.id },
          ],
        },
      }),
    )
    expect((await view(linked.id)).related.map((p) => p.id)).toEqual([b.id])
  })

  test('menu is the enabled tree in order', async () => {
    const men = await category({ name: 'Men', position: 2 })
    const women = await category({ name: 'Women', position: 1 })
    await category({ name: 'Hidden', enabled: false })
    const tops = await category({
      name: 'Tops',
      parentId: women.id,
      translations: { fa: { name: 'بالاپوش' } },
    })
    await category({ name: 'Bags', parentId: women.id })
    const tees = await category({ name: 'Tees', parentId: tops.id })
    await category({ name: 'Too deep', parentId: tees.id })
    await category({ name: 'Off', parentId: men.id, enabled: false })
    const menu = output<{
      items: {
        name: string
        children: { name: string; children: { name: string; children: unknown[] }[] }[]
      }[]
    }>(await call('catalog.menu', {}, guestActor))
    expect(menu.items.map((c) => c.name)).toEqual(['Women', 'Men'])
    expect(menu.items[0]?.children.map((c) => c.name)).toEqual(['Bags', 'Tops'])
    expect(menu.items[0]?.children[1]?.children).toEqual([
      { id: tees.id, slug: 'tees', name: 'Tees', children: [] },
    ])
    expect(menu.items[1]?.children).toEqual([])
    const fa = output<{ items: { children: { name: string }[] }[] }>(
      await call('catalog.menu', { locale: 'fa' }, guestActor),
    )
    expect(fa.items[0]?.children.map((c) => c.name)).toContain('بالاپوش')

    const shown = output<{
      name: string
      children: { name: string }[]
      breadcrumbs: { name: string }[]
    }>(await call('catalog.category-view', { id: tops.id }, guestActor))
    expect(shown).toMatchObject({
      name: 'Tops',
      children: [{ name: 'Tees' }],
      breadcrumbs: [{ name: 'Women' }, { name: 'Tops' }],
    })
    await call('category.update', { id: women.id, version: 1, values: { enabled: false } })
    expect(failure(await call('catalog.category-view', { id: tops.id }, guestActor)).code).toBe(
      'not_found',
    )
  })
})

describe.each([
  ['category', { name: 'Shirts' }],
  ['attribute-set', { name: 'Clothing', codes: [] }],
  [
    'product',
    { type: 'simple', sku: 'P-1', name: 'Shirt', prices: [{ currency: 'EUR', amount: 1 }] },
  ],
  ['product-variant', { productId: randomUUID(), sku: 'V-1', options: {} }],
])('%s.create', (resource, values) => {
  test('permission denied', async () => {
    const reader: Actor = { type: 'admin', id: 'r', permissions: new Set(['catalog.read']) }
    expect(failure(await call(`${resource}.create`, { values }, reader)).code).toBe('forbidden')
    expect(failure(await call(`${resource}.create`, { values }, guestActor)).code).toBe('forbidden')
  })

  test('invalid input', async () => {
    const error = failure(await call(`${resource}.create`, { values: { ...values, extra: 1 } }))
    expect(error.code).toBe('invalid_input')
    expect(failure(await call(`${resource}.create`, { values: {} })).code).toBe('invalid_input')
  })
})
