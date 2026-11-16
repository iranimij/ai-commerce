import { fileURLToPath } from 'node:url'
import { defineModule } from '@aicommerce/core'
import type { MigrationSource } from '@aicommerce/db'
import { meta } from './meta.js'
import { pathRules, rebuild, rebuildJob, rebuildPaths, resolve } from './paths.js'
import { redirect, redirectRules } from './redirects.js'
import { sitemap } from './sitemap.js'

export { breadcrumbJsonLd, productJsonLd } from './json-ld.js'
export { describeText, meta } from './meta.js'
export { RESERVED, rebuild, rebuildJob, rebuildPaths, resolve } from './paths.js'
export { redirect, shopPath } from './redirects.js'
export { SITEMAP_PAGE_SIZE, sitemap } from './sitemap.js'

export const seoMigrations: MigrationSource = {
  module: 'seo',
  dir: fileURLToPath(new URL('../migrations', import.meta.url)),
}

export const seo = defineModule({
  name: 'seo',
  label: 'SEO',
  description: 'Clean URLs, redirects, meta tags, structured data and the sitemap',
  depends: ['catalog'],
  resources: [redirect],
  actions: [resolve, meta, sitemap, rebuild, rebuildPaths],
  jobs: [rebuildJob],
  wraps: [...redirectRules, ...pathRules],
})
