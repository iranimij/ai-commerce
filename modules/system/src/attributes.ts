import {
  ActionError,
  appInfo,
  attributeInput,
  attributeStore,
  defineAction,
  merchantAttribute,
  type ActionContext,
} from '@aicommerce/core'
import { z } from 'zod'

const resource = z.string().regex(/^[a-z][a-z0-9-]*$/)
const definition = z.object({
  resource: z.string(),
  code: z.string(),
  label: z.string(),
  type: z.string(),
  options: z.array(z.string()).optional(),
  required: z.boolean(),
  privacy: z.string(),
  source: z.enum(['module', 'merchant']),
  module: z.string().optional(),
})

const attributesOf = async (ctx: ActionContext, name: string) => [
  ...ctx.service(appInfo).moduleAttributes(name),
  ...(await ctx.service(attributeStore).list(name)),
]

export const listAttributes = defineAction({
  name: 'attribute.list',
  description: 'List the attributes of a resource, from modules and from the merchant',
  input: z.object({ resource }),
  output: z.object({ items: z.array(definition) }),
  permission: 'attribute.read',
  risk: 'read',
  handler: async (input, ctx) => ({ items: await attributesOf(ctx, input.resource) }),
})

export const createAttribute = defineAction({
  name: 'attribute.create',
  description: 'Add an attribute to a resource',
  input: attributeInput,
  output: definition,
  permission: 'attribute.manage',
  risk: 'write',
  handler: async (input, ctx) => {
    const target = ctx
      .service(appInfo)
      .resources()
      .find((r) => r.name === input.resource)
    if (!target?.attributes) {
      throw new ActionError(
        'invalid_input',
        `"${input.resource}" is not a resource with attributes`,
      )
    }
    if ((await attributesOf(ctx, input.resource)).some((a) => a.code === input.code)) {
      throw new ActionError('conflict', `Attribute "${input.code}" already exists`)
    }
    const def = merchantAttribute(input)
    await ctx.service(attributeStore).create(def)
    return def
  },
})

export const deleteAttribute = defineAction({
  name: 'attribute.delete',
  description: 'Delete a merchant attribute; stored values are kept and hidden',
  input: z.object({ resource, code: z.string().max(64) }),
  output: z.object({}),
  permission: 'attribute.manage',
  risk: 'destructive',
  handler: async (input, ctx) => {
    const owned = ctx
      .service(appInfo)
      .moduleAttributes(input.resource)
      .find((a) => a.code === input.code)
    if (owned) {
      throw new ActionError(
        'forbidden',
        `Attribute "${input.code}" is defined by module "${owned.module ?? ''}" and cannot be deleted`,
      )
    }
    if (!(await ctx.service(attributeStore).delete(input.resource, input.code))) {
      throw new ActionError('not_found', `Attribute "${input.code}" not found`)
    }
    return {}
  },
})
