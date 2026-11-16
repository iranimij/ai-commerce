# Catalog

The `catalog` module holds products, variants, categories and attribute sets, the rules that keep
them consistent, and the public read actions the storefront uses. Code:
[`modules/catalog/src`](../../modules/catalog/src), tests in
[`catalog.integration.test.ts`](../../modules/catalog/src/catalog.integration.test.ts).

```ts
const call = (name: string, input: unknown) => app.registry.call(name, input, { actor })

// A select attribute to make variants from (public, so visitors may see it).
await call('attribute.create', {
  resource: 'product',
  code: 'color',
  label: 'Colour',
  type: 'select',
  options: ['red', 'blue'],
  swatches: { red: { color: '#ff0000' }, blue: { color: '#0000ff' } },
  privacy: 'public',
})
const shirts = await call('category.create', { values: { name: 'Shirts' } }) // slug "shirts"
const tee = await call('product.create', {
  values: {
    type: 'configurable',
    sku: 'TEE',
    name: 'Blue Tee', // slug "blue-tee"; a second "Blue Tee" gets "blue-tee-2"
    status: 'active',
    configurableAttributes: ['color'],
    categoryIds: [shirts.output.id],
    media: [{ kind: 'image', file: uploadedFileId, alt: 'Front' }],
    translations: { fa: { name: 'تی‌شرت آبی' } },
  },
})
await call('product-variant.create', {
  values: {
    productId: tee.output.id,
    sku: 'TEE-RED',
    options: { color: 'red' },
    prices: [{ currency: 'EUR', amount: 1900 }], // minor units
  },
})

// As a visitor (no permission needed):
await call('catalog.product-view', { id: tee.output.id, locale: 'fa', currency: 'EUR' })
await call('catalog.category-view', { id: shirts.output.id })
await call('catalog.menu', {})
```

| Name                                              | What it does                                                    | Permission        |
| ------------------------------------------------- | --------------------------------------------------------------- | ----------------- |
| `category.*`, `attribute-set.*`, `product.*`, ... | The resources (list, get, create, update, delete, history, ...) | `catalog.*`       |
| `product-variant.*`                               | Variants of a configurable product                              | `catalog.*`       |
| `catalog.product-view`                            | `{ id, locale?, currency? }` → `ProductView`                    | public            |
| `catalog.category-view`                           | `{ id, locale? }` → the category, its children, breadcrumbs     | public            |
| `catalog.menu`                                    | `{ locale? }` → the enabled tree, three levels deep             | public            |
| `productCards(ctx, ids, { locale?, currency? })`  | Cards of the active products among `ids`, in order              | (code, for reads) |

Tables: `catalog_category`, `catalog_attribute_set`, `catalog_product`, `catalog_product_variant`
and `catalog_sku`. A category's descendants are a recursive query on `catalog_category.parent_id`;
a category's products are `catalog_product.category_ids @> '["<id>"]'` (GIN-indexed).

## Rules that bite

- The four resources share `catalog.read`, `catalog.write` and `catalog.delete`: deleting a product
  deletes its variants through `product-variant.delete` (each gets a revision and an audit row).
- A slug is lower-case letters, digits and marks of any script, words joined by `-`
  ("پیراهن-آبی" is one). Left out, it comes from the name, with `-2`, `-3` on a clash (per parent
  for categories). A slug you give is kept as given, so a taken one is `conflict`. Renaming never
  changes the slug; send a new `slug` to move the URL.
- SKUs are unique across products and variants (`catalog_sku`). Changing a SKU frees the old one.
- A product's `type` is fixed once created. A simple product needs a price; a configurable one
  needs 1 to 3 `select` attributes in `configurableAttributes`, which cannot change while it has
  variants. A variant gives exactly one existing option for each, and no two variants of a product
  may have the same options.
- At most one price per currency and channel. Views use the price without a channel in the asked
  currency, and never convert: no price in that currency is `price: null`.
- `categoryIds`, image `file`s, `links` and `attributeSetId` must exist when written; a product
  cannot link to itself. A category cannot be its own ancestor; one with subcategories or products
  cannot be deleted (`conflict`, naming the count). To clear `parentId` or `attributeSetId`, send
  `null`.
- Restore runs the same rules: restoring a product whose category is gone is `invalid_input`.
  Restoring a product does not bring its deleted variants back; restore each.
- Public views show only `active` products, enabled variants, and categories whose whole path is
  enabled. Anything that has gone since (a media file, an attribute, a swatch image, the attribute
  set) is left out, never an error.
- Specifications list the attribute set's attributes (all attributes without one) that are
  `public` and have a value. Variant options are shown whatever the attribute's privacy class.
- `price.from` is true when the enabled variants' prices differ; the amount is the lowest.
- Translations fall back field by field: the asked locale, then the shop language, then the
  record's own value. Descriptions are Markdown, never HTML.
