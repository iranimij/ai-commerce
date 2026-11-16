import {
  ActionError,
  appInfo,
  defineAction,
  dependentsOf,
  moduleState,
  resolveModules,
  type ActionContext,
} from '@aicommerce/core'
import { z } from 'zod'

const name = z.string().regex(/^[a-z][a-z0-9-]*$/)

// The stored list; before anything is stored (a fresh install), the modules this app runs.
async function current(ctx: ActionContext): Promise<string[]> {
  return (await ctx.service(moduleState).enabled()) ?? ctx.service(appInfo).enabledModules()
}

function known(ctx: ActionContext, module: string) {
  const all = ctx.service(appInfo).modules()
  const found = all.find((m) => m.name === module)
  if (!found) throw new ActionError('not_found', `Unknown module "${module}"`)
  return { all, found }
}

export const listModules = defineAction({
  name: 'module.list',
  description: 'List every module of this install, with whether it is switched on',
  input: z.object({}),
  output: z.array(
    z.object({
      name: z.string(),
      label: z.string(),
      description: z.string(),
      enabled: z.boolean(),
      required: z.boolean(),
      depends: z.array(z.string()),
    }),
  ),
  permission: 'module.read',
  risk: 'read',
  handler: async (_input, ctx) => {
    const enabled = new Set(await current(ctx))
    return ctx
      .service(appInfo)
      .modules()
      .map((m) => ({ ...m, enabled: enabled.has(m.name) }))
  },
})

export const enableModule = defineAction({
  name: 'module.enable',
  description: 'Switch a module on, with the modules it needs; its tables are created if new',
  input: z.object({ name }),
  output: z.object({
    enabled: z.array(z.string()),
    added: z.array(z.object({ module: z.string(), requiredBy: z.string().nullable() })),
  }),
  permission: 'module.manage',
  risk: 'write',
  handler: async (input, ctx) => {
    const { all } = known(ctx, input.name)
    const before = await current(ctx)
    const resolved = resolveModules(all, [...before, input.name])
    const added = resolved.added.filter((a) => !before.includes(a.module))
    if (resolved.enabled.join() !== before.join()) {
      await ctx
        .service(moduleState)
        .set(resolved.enabled, { action: ctx.actionName, actor: ctx.actor })
    }
    return { enabled: resolved.enabled, added }
  },
})

export const disableModule = defineAction({
  name: 'module.disable',
  description: 'Switch a module off. Its data is kept and comes back when it is switched on again',
  input: z.object({ name }),
  output: z.object({ enabled: z.array(z.string()) }),
  permission: 'module.manage',
  risk: 'destructive',
  handler: async (input, ctx) => {
    const { all, found } = known(ctx, input.name)
    if (found.required) {
      throw new ActionError('conflict', `Module "${input.name}" is required and cannot be disabled`)
    }
    const before = await current(ctx)
    if (!before.includes(input.name)) return { enabled: before }
    const dependents = dependentsOf(all, before, input.name)
    if (dependents.length > 0) {
      throw new ActionError(
        'conflict',
        `Module "${input.name}" is needed by ${dependents.join(', ')}; disable those first`,
      )
    }
    const enabled = before.filter((m) => m !== input.name)
    await ctx.service(moduleState).set(enabled, { action: ctx.actionName, actor: ctx.actor })
    return { enabled }
  },
})
