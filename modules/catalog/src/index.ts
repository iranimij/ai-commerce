import { fileURLToPath } from 'node:url'
import { defineModule } from '@aicommerce/core'
import type { MigrationSource } from '@aicommerce/db'
import { attributeSet, category, product, productVariant } from './resources.js'
import { rules } from './rules.js'
import { categoryView, menu, productView } from './views.js'

export {
  attributeSet,
  category,
  link,
  mediaEntry,
  price,
  product,
  productVariant,
  translations,
  type Link,
  type MediaEntry,
  type Price,
} from './resources.js'
export { localize } from './localize.js'
export { isSlug, slugify } from './slug.js'
export {
  categoryView,
  menu,
  productCards,
  productCardSchema,
  productView,
  productViewSchema,
  type Crumb,
  type ProductCard,
  type ProductView,
  type ViewMedia,
  type ViewPrice,
} from './views.js'

export const catalogMigrations: MigrationSource = {
  module: 'catalog',
  dir: fileURLToPath(new URL('../migrations', import.meta.url)),
}

export const catalog = defineModule({
  name: 'catalog',
  label: 'Catalog',
  description: 'Products, variants, categories and attribute sets',
  depends: ['media'],
  resources: [category, attributeSet, product, productVariant],
  actions: [productView, categoryView, menu],
  wraps: rules,
})
