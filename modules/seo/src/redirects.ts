import {
  ActionError,
  classify,
  defineResource,
  resourceStore,
  type ActionContext,
  type ActionWrap,
} from '@aicommerce/core'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { anyText, must, rows } from './sql.js'

const pub = <S extends z.ZodType>(schema: S) => classify(schema, 'public')

/**
 * A path on this shop: "/" not followed by "/" or "\", with no spaces, backslashes or control
 * characters. Without a scheme or a host it can never send a visitor to another site.
 */
export const shopPath = z
  .string()
  .max(2000)
  .regex(/^\/(?![/\\])[^\s\\\p{Cc}]*$/u, 'Use a path on this shop, such as /new-name')

export const redirect = defineResource({
  name: 'redirect',
  module: 'seo',
  label: { singular: 'Redirect', plural: 'Redirects' },
  fields: z.strictObject({
    from: pub(shopPath),
    to: pub(shopPath),
    status: pub(z.union([z.literal(301), z.literal(302)])).default(301),
    /** Written by a rename or a move, not by a person. */
    auto: pub(z.boolean()).default(false),
  }),
  permissions: { read: 'seo.read', write: 'seo.write', delete: 'seo.delete' },
})

interface Ends {
  from: string
  to: string
}

const invalid = (field: string, message: string) =>
  new ActionError('invalid_input', message, [
    { code: 'custom', path: ['values', field], message, input: undefined },
  ])

export const isLive = async (ctx: ActionContext, path: string) =>
  (await rows(ctx, sql`select 1 from seo_path where path = ${path}`)).length > 0

/**
 * Checks a redirect may be `from` → `to` and returns where it should point: when `to` is itself
 * redirected, straight to where that one goes, so a visitor never takes two hops.
 */
async function settle(ctx: ActionContext, ends: Ends, id: string | null): Promise<string> {
  if (ends.from === ends.to) throw invalid('to', 'A redirect cannot point to itself')
  if (await isLive(ctx, ends.from)) {
    throw new ActionError('conflict', `${ends.from} is a live page; change its slug to move it`)
  }
  const [onward] = await rows(
    ctx,
    sql`select "to" from seo_redirect where "from" = ${ends.to} and id is distinct from ${id}::uuid`,
  )
  const to = onward ? String(onward.to) : ends.to
  if (to === ends.from) throw invalid('to', `This would loop: ${ends.to} redirects to ${ends.from}`)
  return to
}

/** Every redirect into `from` now goes straight to `to`. */
async function repoint(ctx: ActionContext, ends: Ends, id: string): Promise<void> {
  const inbound = await rows(
    ctx,
    sql`select id, version from seo_redirect where "to" = ${ends.from} and id <> ${id}`,
  )
  for (const r of inbound) {
    must(
      await ctx.call('redirect.update', { id: r.id, version: r.version, values: { to: ends.to } }),
    )
  }
}

/** Removes the redirect from a path that is live again. A revision records it. */
export async function unredirect(ctx: ActionContext, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return
  const found = await rows(
    ctx,
    sql`select id, version from seo_redirect where "from" in ${anyText(paths)}`,
  )
  // Not through redirect.delete: that is destructive and would need a confirmation the rename
  // that caused it never asked for.
  const store = ctx.service(resourceStore)
  for (const r of found) {
    await store.delete(redirect, String(r.id), Number(r.version), {
      action: ctx.actionName,
      actor: ctx.actor,
    })
  }
}

type Input = Record<string, unknown> & { values?: Partial<Ends> }
const on = (
  verb: string,
  wrap: (
    input: Input,
    ctx: ActionContext,
    next: (input: unknown) => Promise<unknown>,
  ) => Promise<unknown>,
): ActionWrap => ({ action: `redirect.${verb}`, module: 'seo', order: 0, wrap })

export const redirectRules: ActionWrap[] = [
  on('create', async (input, ctx, next) => {
    const values = input.values as Ends
    const to = await settle(ctx, values, null)
    const out = (await next({ ...input, values: { ...values, to } })) as Ends & { id: string }
    await repoint(ctx, out, out.id)
    return out
  }),
  on('update', async (input, ctx, next) => {
    const id = String(input.id)
    const before = await ctx.service(resourceStore).get(redirect, id)
    // A missing record or a stale version fails in the handler.
    if (!before) return next(input)
    const ends = { ...(before as unknown as Ends), ...input.values }
    const to = await settle(ctx, ends, id)
    const values = to === ends.to ? input.values : { ...input.values, to }
    const out = (await next({ ...input, values })) as Ends & { id: string }
    await repoint(ctx, out, id)
    return out
  }),
  on('restore', async (input, ctx, next) => {
    const out = (await next(input)) as Ends & { id: string }
    // The snapshot is written as it was, so it may not need a second hop.
    if ((await settle(ctx, out, out.id)) !== out.to) {
      throw new ActionError('conflict', `${out.to} is redirected now; edit this redirect instead`)
    }
    await repoint(ctx, out, out.id)
    return out
  }),
]
