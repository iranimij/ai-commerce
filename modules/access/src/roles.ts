import { randomUUID } from 'node:crypto'
import { adminRole, adminUserRole } from '@aicommerce/auth'
import { ActionError, defineAction, type ActionContext } from '@aicommerce/core'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { assertGrantable, assertKnown, db } from './rules.js'

const permissions = z.array(z.string().min(1).max(200)).max(500)
const role = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(z.string()),
  system: z.boolean(),
})

async function editable(ctx: ActionContext, id: string) {
  const [found] = await db(ctx).select().from(adminRole).where(eq(adminRole.id, id)).for('update')
  if (!found) throw new ActionError('not_found', 'Role not found')
  if (found.system) throw new ActionError('forbidden', `The ${found.name} role cannot be changed`)
  return found
}

export const listRoles = defineAction({
  name: 'role.list',
  description: 'List admin roles and their permissions',
  input: z.object({}),
  output: z.object({ items: z.array(role) }),
  permission: 'role.read',
  risk: 'read',
  handler: async (_input, ctx) => {
    const rows = await db(ctx).select().from(adminRole).orderBy(asc(adminRole.createdAt))
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        permissions: r.permissions,
        system: r.system,
      })),
    }
  },
})

export const createRole = defineAction({
  name: 'role.create',
  description: 'Create an admin role',
  input: z.object({ name: z.string().min(1).max(100), permissions }),
  output: role,
  permission: 'role.manage',
  risk: 'write',
  handler: async (input, ctx) => {
    assertKnown(ctx, input.permissions)
    assertGrantable(ctx, input.permissions)
    const created = {
      id: randomUUID(),
      name: input.name,
      permissions: [...new Set(input.permissions)],
    }
    await db(ctx).insert(adminRole).values(created)
    return { ...created, system: false }
  },
})

export const updateRole = defineAction({
  name: 'role.update',
  description: 'Rename a role or change its permissions',
  input: z.object({
    id: z.string().max(100),
    name: z.string().min(1).max(100).optional(),
    permissions: permissions.optional(),
  }),
  output: role,
  permission: 'role.manage',
  risk: 'write',
  handler: async (input, ctx) => {
    const found = await editable(ctx, input.id)
    // Editing a role touches everyone who holds it: old and new permissions must be the caller's.
    assertGrantable(ctx, found.permissions)
    if (input.permissions) {
      assertKnown(ctx, input.permissions)
      assertGrantable(ctx, input.permissions)
    }
    const next = {
      name: input.name ?? found.name,
      permissions: input.permissions ? [...new Set(input.permissions)] : found.permissions,
    }
    await db(ctx).update(adminRole).set(next).where(eq(adminRole.id, input.id))
    return { id: found.id, ...next, system: false }
  },
})

export const deleteRole = defineAction({
  name: 'role.delete',
  description: 'Delete a role nobody holds',
  input: z.object({ id: z.string().max(100) }),
  output: z.object({}),
  permission: 'role.manage',
  risk: 'destructive',
  handler: async (input, ctx) => {
    const found = await editable(ctx, input.id)
    assertGrantable(ctx, found.permissions)
    const holders = await db(ctx)
      .select({ userId: adminUserRole.userId })
      .from(adminUserRole)
      .where(eq(adminUserRole.roleId, input.id))
      .limit(1)
    if (holders.length > 0)
      throw new ActionError('conflict', 'This role is still assigned to admins')
    await db(ctx).delete(adminRole).where(eq(adminRole.id, input.id))
    return {}
  },
})
