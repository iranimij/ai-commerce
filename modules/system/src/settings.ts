import {
  ActionError,
  appInfo,
  can,
  defineAction,
  settingStore,
  type ActionContext,
  type SettingDefinition,
} from '@aicommerce/core'
import { z } from 'zod'

const key = z.string().max(200)
const channel = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
  .optional()

function definition(ctx: ActionContext, name: string): SettingDefinition {
  const def = ctx
    .service(appInfo)
    .settings()
    .find((s) => s.key === name)
  if (!def) throw new ActionError('not_found', `Setting "${name}" not found`)
  return def
}

// Each setting may need a permission of its own on top of setting.manage.
function writable(ctx: ActionContext, name: string, channelName: string | undefined) {
  const def = definition(ctx, name)
  if (!can(ctx.actor, def.permission)) {
    throw new ActionError('forbidden', `Changing "${name}" needs permission "${def.permission}"`)
  }
  if (channelName !== undefined && def.scope !== 'channel') {
    throw new ActionError('invalid_input', `Setting "${name}" has no per-channel values`)
  }
  return def
}

const meta = (ctx: ActionContext) => ({ action: ctx.actionName, actor: ctx.actor })

export const listSettings = defineAction({
  name: 'setting.list',
  description: 'List settings with their current global values; secret values are never shown',
  input: z.object({ module: z.string().max(100).optional() }),
  output: z.object({
    items: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        scope: z.enum(['global', 'channel']),
        privacy: z.string(),
        value: z.unknown().optional(),
        isSet: z.boolean(),
        isDefault: z.boolean(),
      }),
    ),
  }),
  permission: 'setting.read',
  risk: 'read',
  handler: async (input, ctx) => {
    const defs = ctx
      .service(appInfo)
      .settings()
      .filter((s) => input.module === undefined || s.module === input.module)
    const items = []
    for (const def of defs) {
      const stored = await ctx
        .service(settingStore)
        .read(def.key, null)
        .catch(() => undefined)
      const value = stored?.value ?? def.default
      items.push({
        key: def.key,
        label: def.label,
        scope: def.scope,
        privacy: def.privacy,
        ...(def.privacy !== 'secret' && value !== undefined && { value }),
        isSet: stored !== undefined,
        isDefault: stored === undefined,
      })
    }
    return { items }
  },
})

export const setSetting = defineAction({
  name: 'setting.set',
  description: 'Change a setting, globally or for one channel',
  input: z.object({ key, value: z.unknown(), channel }),
  output: z.object({ key: z.string(), version: z.number().int() }),
  permission: 'setting.manage',
  risk: 'write',
  redact: ['value'],
  handler: async (input, ctx) => {
    const def = writable(ctx, input.key, input.channel)
    const parsed = def.schema.safeParse(input.value)
    if (!parsed.success) {
      throw new ActionError(
        'invalid_input',
        `Invalid value for "${input.key}"`,
        parsed.error.issues.map((i) => ({ ...i, path: ['value', ...i.path] })),
      )
    }
    const version = await ctx
      .service(settingStore)
      .write(def, input.channel ?? null, parsed.data, meta(ctx))
    return { key: def.key, version }
  },
})

export const resetSetting = defineAction({
  name: 'setting.reset',
  description: 'Remove a stored setting value, so the default (or the global value) applies again',
  input: z.object({ key, channel }),
  output: z.object({ removed: z.boolean() }),
  permission: 'setting.manage',
  risk: 'write',
  handler: async (input, ctx) => {
    const def = writable(ctx, input.key, input.channel)
    return {
      removed: await ctx.service(settingStore).remove(def, input.channel ?? null, meta(ctx)),
    }
  },
})

export const settingHistory = defineAction({
  name: 'setting.history',
  description: 'List the changes to a setting, newest first',
  input: z.object({
    key,
    channel,
    cursor: z.string().max(20).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        action: z.string(),
        actorType: z.string(),
        actorId: z.string().nullable(),
        onBehalfOf: z.string().nullable(),
        at: z.string(),
        version: z.number().int().nullable(),
        before: z.record(z.string(), z.unknown()).nullable(),
        after: z.record(z.string(), z.unknown()).nullable(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  permission: 'setting.read',
  risk: 'read',
  handler: async (input, ctx) => {
    definition(ctx, input.key)
    return ctx
      .service(settingStore)
      .history(input.key, input.channel ?? null, input.cursor, input.limit)
  },
})
