import { fileURLToPath } from 'node:url'
import { adminUserRole, identity } from '@aicommerce/auth'
import {
  ActionError,
  appInfo,
  can,
  defineAction,
  defineModule,
  defineSetting,
  moduleState,
  PRESETS,
  resolveModules,
  settingStore,
  type ActionContext,
} from '@aicommerce/core'
import { databaseService, type MigrationSource } from '@aicommerce/db'
import { SUPPORTED_LOCALES } from '@aicommerce/i18n'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { tokenMatches } from './token.js'

export { issueSetupToken } from './token.js'

export const setupMigrations: MigrationSource = {
  module: 'setup',
  dir: fileURLToPath(new URL('../migrations', import.meta.url)),
}

export const shopName = defineSetting({
  key: 'shop.name',
  module: 'setup',
  label: 'Shop name',
  schema: z.string().trim().min(1).max(100),
  privacy: 'public',
  scope: 'channel',
})
export const shopCountry = defineSetting({
  key: 'shop.country',
  module: 'setup',
  label: 'Country (ISO 3166-1 alpha-2)',
  schema: z.string().regex(/^[A-Z]{2}$/),
  privacy: 'public',
  scope: 'global',
})
export const shopCurrency = defineSetting({
  key: 'shop.currency',
  module: 'setup',
  label: 'Currency (ISO 4217)',
  schema: z.string().regex(/^[A-Z]{3}$/),
  privacy: 'public',
  scope: 'channel',
})
export const shopLanguage = defineSetting({
  key: 'shop.language',
  module: 'setup',
  label: 'Language',
  schema: z.enum(SUPPORTED_LOCALES),
  default: 'en',
  privacy: 'public',
  scope: 'channel',
})
export const aiKey = defineSetting({
  key: 'setup.ai-key',
  module: 'setup',
  label: 'AI provider key',
  schema: z.string().min(1).max(500),
  privacy: 'secret',
  scope: 'global',
})

const db = (ctx: ActionContext) => ctx.service(databaseService).current()
const meta = (ctx: ActionContext) => ({ action: ctx.actionName, actor: ctx.actor })
const token = z.string().max(200).optional()
const step = z.enum(['owner', 'two-factor', 'shop', 'modules', 'done'])

interface State {
  tokenHash: string | null
  modules: string[] | null
  finished: boolean
}

async function readState(ctx: ActionContext): Promise<State> {
  const [row] = (await db(ctx).execute(
    sql`select token_hash, modules, finished_at from setup_state for update`,
  )) as unknown as Record<string, unknown>[]
  return {
    tokenHash: (row?.token_hash as string | null) ?? null,
    modules: (row?.modules as string[] | null) ?? null,
    finished: row?.finished_at !== null && row?.finished_at !== undefined,
  }
}

/**
 * The actions are public, so each one checks for itself: the one-time token, or, once an owner
 * with 2FA is signed in, the owner (so a lost token or a restart does not lock setup).
 */
async function authorize(ctx: ActionContext, given: string | undefined, ownerMay = true) {
  const state = await readState(ctx)
  if (state.finished) throw new ActionError('forbidden', 'Setup is finished')
  if (given !== undefined && tokenMatches(given, state.tokenHash)) return state
  if (ownerMay && ctx.actor.type !== 'guest' && can(ctx.actor, '*')) return state
  throw new ActionError('forbidden', 'A valid setup token is needed')
}

async function nextStep(ctx: ActionContext, state: State): Promise<z.infer<typeof step>> {
  if (state.finished) return 'done'
  const owners = (await db(ctx).execute(sql`select u.two_factor_enabled from admin_user u
    join admin_user_role r on r.user_id = u.id
    where r.role_id = 'owner' and not u.disabled`)) as unknown as Record<string, unknown>[]
  if (owners.length === 0) return 'owner'
  if (!owners.some((o) => o.two_factor_enabled === true)) return 'two-factor'
  if ((await ctx.service(settingStore).read(shopName.key, null)) === undefined) return 'shop'
  return 'modules'
}

export const status = defineAction({
  name: 'setup.status',
  description: 'Whether first-run setup is finished, and which step comes next',
  input: z.object({}),
  output: z.object({
    finished: z.boolean(),
    next: step,
    database: z.object({ ok: z.boolean(), version: z.string().nullable() }),
  }),
  permission: null,
  risk: 'read',
  handler: async (_input, ctx) => {
    const state = await readState(ctx)
    // The version only helps while setting up; afterwards it is nobody's business.
    let version: string | null = null
    if (!state.finished) {
      const [row] = (await db(ctx).execute(
        sql`select current_setting('server_version') as v`,
      )) as unknown as Record<string, unknown>[]
      version = String(row?.v)
    }
    return {
      finished: state.finished,
      next: await nextStep(ctx, state),
      database: { ok: true, version },
    }
  },
})

export const createOwner = defineAction({
  name: 'setup.create-owner',
  description: 'Create the first admin, with the owner role',
  input: z.object({
    token,
    email: z.email().max(200),
    name: z.string().trim().min(1).max(100),
    password: z.string().min(12).max(128),
  }),
  output: z.object({ id: z.string() }),
  permission: null,
  risk: 'write',
  handler: async (input, ctx) => {
    await authorize(ctx, input.token, false)
    const [existing] = (await db(ctx).execute(
      sql`select 1 from admin_user_role where role_id = 'owner' limit 1`,
    )) as unknown as unknown[]
    if (existing) throw new ActionError('conflict', 'An owner already exists')
    const { id } = await ctx.service(identity).createAdmin(input)
    await db(ctx).insert(adminUserRole).values({ userId: id, roleId: 'owner' })
    return { id }
  },
})

export const saveShop = defineAction({
  name: 'setup.save-shop',
  description: 'Save the shop name, country, currency, language and, optionally, an AI key',
  input: z.object({
    token,
    name: shopName.schema,
    country: shopCountry.schema,
    currency: shopCurrency.schema,
    language: shopLanguage.schema,
    aiKey: aiKey.schema.optional(),
  }),
  output: z.object({}),
  permission: null,
  risk: 'write',
  redact: ['aiKey'],
  handler: async (input, ctx) => {
    await authorize(ctx, input.token)
    const store = ctx.service(settingStore)
    await store.write(shopName, null, input.name, meta(ctx))
    await store.write(shopCountry, null, input.country, meta(ctx))
    await store.write(shopCurrency, null, input.currency, meta(ctx))
    await store.write(shopLanguage, null, input.language, meta(ctx))
    if (input.aiKey !== undefined) await store.write(aiKey, null, input.aiKey, meta(ctx))
    return {}
  },
})

export const chooseModules = defineAction({
  name: 'setup.choose-modules',
  description: 'Choose the modules to start with, by preset or by name; applied by setup.finish',
  input: z.object({
    token,
    preset: z.enum(['minimal', 'full']).optional(),
    modules: z.array(z.string().max(100)).max(200).optional(),
  }),
  output: z.object({
    enabled: z.array(z.string()),
    added: z.array(z.object({ module: z.string(), requiredBy: z.string().nullable() })),
  }),
  permission: null,
  risk: 'write',
  handler: async (input, ctx) => {
    await authorize(ctx, input.token)
    if ((input.preset === undefined) === (input.modules === undefined)) {
      throw new ActionError('invalid_input', 'Send either a preset or a list of modules')
    }
    const all = ctx.service(appInfo).modules()
    let resolved
    try {
      resolved = resolveModules(
        all,
        input.preset ? PRESETS[input.preset](all) : (input.modules ?? []),
      )
    } catch (error) {
      throw new ActionError('invalid_input', (error as Error).message)
    }
    await db(ctx).execute(
      sql`update setup_state set modules = array[${sql.join(
        resolved.enabled.map((m) => sql`${m}`),
        sql`, `,
      )}]::text[]`,
    )
    return resolved
  },
})

const BLOCKED: Record<string, string> = {
  owner: 'Create the owner first',
  'two-factor': 'The owner must turn on two-factor authentication first',
  shop: 'Save the shop details first',
}

export const finish = defineAction({
  name: 'setup.finish',
  description: 'Switch on the chosen modules and close setup for good; the token stops working',
  input: z.object({ token }),
  output: z.object({ enabled: z.array(z.string()) }),
  permission: null,
  risk: 'write',
  handler: async (input, ctx) => {
    const state = await authorize(ctx, input.token)
    const blocked = BLOCKED[await nextStep(ctx, state)]
    if (blocked) throw new ActionError('conflict', blocked)
    if (!state.modules) throw new ActionError('conflict', 'Choose the modules first')
    await ctx.service(moduleState).set(state.modules, meta(ctx))
    await db(ctx).execute(
      sql`update setup_state set token_hash = null, finished_at = date_trunc('milliseconds', now())`,
    )
    return { enabled: state.modules }
  },
})

export const setup = defineModule({
  name: 'setup',
  label: 'Setup',
  description: 'First-run setup: the owner account, the shop basics and the modules to start with',
  required: true,
  namespaces: ['setup', 'shop'],
  actions: [status, createOwner, saveShop, chooseModules, finish],
  settings: [shopName, shopCountry, shopCurrency, shopLanguage, aiKey],
})
