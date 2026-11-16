import { ActionError, classify, defineAction, settings } from '@aicommerce/core'
import { shopName } from '@aicommerce/module-setup'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { must, rows } from './sql.js'

const pub = <S extends z.ZodType>(schema: S) => classify(schema, 'public')

/** Markdown as plain text on one line, cut at a word to at most `max` characters. */
export function describeText(markdown: string, max = 160): string {
  const text = markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // By code point, so a letter outside the BMP is never cut in half.
  const chars = Array.from(text)
  if (chars.length <= max) return text
  const head = chars.slice(0, max - 1).join('')
  const space = head.lastIndexOf(' ')
  return `${space > 0 ? head.slice(0, space) : head}…`
}

interface Viewed {
  name: string
  metaTitle?: string
  metaDescription?: string
  shortDescription?: string
  description?: string
}

export const meta = defineAction({
  name: 'seo.meta',
  description:
    'The title, description, canonical path and robots rule of a product or category page',
  input: z.object({
    kind: z.enum(['product', 'category']),
    id: z.uuid(),
    /** Default: the shop language. */
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .optional(),
  }),
  output: pub(
    z.object({
      title: z.string(),
      description: z.string(),
      /** The page's live path; the storefront adds its origin. */
      canonical: z.string(),
      robots: z.string(),
    }),
  ),
  permission: null,
  risk: 'read',
  handler: async (input, ctx) => {
    // Through the public view, so a draft or a hidden category is not_found here too.
    const view = must(
      await ctx.call(`catalog.${input.kind}-view`, {
        id: input.id,
        ...(input.locale && { locale: input.locale }),
      }),
    ) as Viewed
    const [live] = await rows(
      ctx,
      sql`select path from seo_path where record_id = ${input.id} and kind = ${input.kind}`,
    )
    if (!live) throw new ActionError('not_found', 'This page has no path; run seo.rebuild')
    const shop = await ctx.service(settings).get(shopName)
    const title = view.metaTitle ?? view.name
    return {
      title: shop ? `${title} | ${shop}` : title,
      description:
        view.metaDescription ?? describeText(view.shortDescription ?? view.description ?? ''),
      canonical: String(live.path),
      robots: 'index, follow',
    }
  },
})
