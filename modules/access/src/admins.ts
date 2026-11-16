import { adminUser, adminUserRole, identity } from '@aicommerce/auth'
import { ActionError, defineAction, type ActionContext } from '@aicommerce/core'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { assertGrantable, assertNotLastOwner, db, rolePermissions, rolesOf } from './rules.js'

const roles = z.array(z.string().min(1).max(100)).max(50)
const id = z.string().min(1).max(100)

async function existing(ctx: ActionContext, userId: string) {
  const [found] = await db(ctx)
    .select({ id: adminUser.id, disabled: adminUser.disabled })
    .from(adminUser)
    .where(eq(adminUser.id, userId))
  if (!found) throw new ActionError('not_found', 'Admin not found')
  return found
}

// Changing an admin needs every permission they have, so nobody acts on someone above them.
async function assertAbove(ctx: ActionContext, userId: string) {
  assertGrantable(ctx, await rolePermissions(ctx, await rolesOf(ctx, userId)))
}

export const listAdmins = defineAction({
  name: 'admin.list',
  description: 'List admin accounts with their roles, 2FA and status',
  input: z.object({}),
  output: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        email: z.string(),
        name: z.string(),
        roles: z.array(z.string()),
        twoFactorEnabled: z.boolean(),
        disabled: z.boolean(),
      }),
    ),
  }),
  permission: 'admin.read',
  risk: 'read',
  handler: async (_input, ctx) => {
    const users = await db(ctx)
      .select({
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name,
        twoFactorEnabled: adminUser.twoFactorEnabled,
        disabled: adminUser.disabled,
      })
      .from(adminUser)
      .orderBy(asc(adminUser.email))
    const links = await db(ctx).select().from(adminUserRole)
    return {
      items: users.map((u) => ({
        ...u,
        roles: links
          .filter((l) => l.userId === u.id)
          .map((l) => l.roleId)
          .sort(),
      })),
    }
  },
})

export const createAdmin = defineAction({
  name: 'admin.create',
  description: 'Create an admin account; they must turn on 2FA before they can do anything',
  input: z.object({
    email: z.email().max(254),
    name: z.string().min(1).max(100),
    password: z.string().min(12).max(128),
    roles,
  }),
  output: z.object({ id: z.string() }),
  permission: 'admin.manage',
  risk: 'write',
  redact: ['password'],
  handler: async (input, ctx) => {
    assertGrantable(ctx, await rolePermissions(ctx, input.roles))
    const created = await ctx.service(identity).createAdmin(input)
    if (input.roles.length > 0) {
      await db(ctx)
        .insert(adminUserRole)
        .values([...new Set(input.roles)].map((roleId) => ({ userId: created.id, roleId })))
    }
    return created
  },
})

export const setRoles = defineAction({
  name: 'admin.set-roles',
  description: "Replace an admin's roles",
  input: z.object({ id, roles }),
  output: z.object({ roles: z.array(z.string()) }),
  permission: 'admin.manage',
  risk: 'write',
  handler: async (input, ctx) => {
    await existing(ctx, input.id)
    const before = await rolesOf(ctx, input.id)
    const after = [...new Set(input.roles)].sort()
    const changed = [
      ...before.filter((r) => !after.includes(r)),
      ...after.filter((r) => !before.includes(r)),
    ]
    assertGrantable(ctx, await rolePermissions(ctx, changed))
    if (before.includes('owner') && !after.includes('owner'))
      await assertNotLastOwner(ctx, input.id)
    await db(ctx).delete(adminUserRole).where(eq(adminUserRole.userId, input.id))
    if (after.length > 0) {
      await db(ctx)
        .insert(adminUserRole)
        .values(after.map((roleId) => ({ userId: input.id, roleId })))
    }
    return { roles: after }
  },
})

export const disableAdmin = defineAction({
  name: 'admin.disable',
  description: 'Disable or re-enable an admin; disabling ends their sessions',
  input: z.object({ id, disabled: z.boolean() }),
  output: z.object({}),
  permission: 'admin.manage',
  risk: 'destructive',
  handler: async (input, ctx) => {
    if (input.disabled && input.id === ctx.actor.id) {
      throw new ActionError('conflict', 'You cannot disable yourself')
    }
    await existing(ctx, input.id)
    await assertAbove(ctx, input.id)
    if (input.disabled) await assertNotLastOwner(ctx, input.id)
    await ctx.service(identity).setDisabled(input.id, input.disabled)
    return {}
  },
})
