import { classify, defineAction } from '@aicommerce/core'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { rows, visible, withRecord } from './sql.js'

/** The sitemap protocol's limit per file. */
export const SITEMAP_PAGE_SIZE = 50_000

export const sitemap = defineAction({
  name: 'seo.sitemap',
  description: 'One page of the sitemap: every live product and category path, ordered by path',
  input: z.object({
    page: z.number().int().min(1).max(100_000).default(1),
    /** URLs per page; a smaller size is for tests and small sitemap files. */
    size: z.number().int().min(1).max(SITEMAP_PAGE_SIZE).default(SITEMAP_PAGE_SIZE),
  }),
  output: classify(
    z.object({
      /** `loc` is a path: the storefront adds its origin. */
      urls: z.array(z.object({ loc: z.string(), lastmod: z.string() })),
      pages: z.number().int(),
    }),
    'public',
  ),
  permission: null,
  risk: 'read',
  handler: async ({ page, size }, ctx) => {
    // shortcut: count and offset scan the path index; fine to a few million paths, then key the
    // pages by their first path.
    const [count] = await rows(
      ctx,
      sql`select count(*)::int as n from ${withRecord} where ${visible}`,
    )
    const found = await rows(
      ctx,
      sql`select s.path, coalesce(p.updated_at, c.updated_at) as lastmod
        from ${withRecord} where ${visible}
        order by s.path limit ${size} offset ${(page - 1) * size}`,
    )
    return {
      urls: found.map((r) => ({
        loc: String(r.path),
        lastmod: new Date(r.lastmod as string).toISOString(),
      })),
      pages: Math.max(1, Math.ceil(Number(count?.n) / size)),
    }
  },
})
