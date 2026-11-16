import { adminRole, adminUser, adminUserRole } from '@aicommerce/auth'
import { ActionError, appInfo, can, type ActionContext } from '@aicommerce/core'
import { databaseService } from '@aicommerce/db'
import { and, eq, inArray } from 'drizzle-orm'

export const db = (ctx: ActionContext) => ctx.service(databaseService).current()

/** Every permission must exist in the running app, or be `*`. */
export function assertKnown(ctx: ActionContext, permissions: readonly string[]): void {
  const known = new Set(ctx.service(appInfo).permissions())
  const unknown = permissions.filter((p) => p !== '*' && !known.has(p))
  if (unknown.length > 0) {
    throw new ActionError('invalid_input', `Unknown permissions: ${unknown.join(', ')}`)
  }
}

/**
 * Nobody can hand out, take away or edit access above their own: every permission involved must
 * be one the caller has. Only a caller with `*` can involve `*`.
 */
export function assertGrantable(ctx: ActionContext, permissions: Iterable<string>): void {
  for (const p of permissions) {
    if (!can(ctx.actor, p)) {
      throw new ActionError('forbidden', 'You cannot grant permissions you do not have')
    }
  }
}

/** The permissions of the given roles; unknown role ids are invalid_input. */
export async function rolePermissions(ctx: ActionContext, roleIds: readonly string[]) {
  if (roleIds.length === 0) return []
  const rows = await db(ctx)
    .select({ id: adminRole.id, permissions: adminRole.permissions })
    .from(adminRole)
    .where(inArray(adminRole.id, [...roleIds]))
  const missing = roleIds.filter((id) => !rows.some((r) => r.id === id))
  if (missing.length > 0) {
    throw new ActionError('invalid_input', `Unknown roles: ${missing.join(', ')}`)
  }
  return rows.flatMap((r) => r.permissions)
}

export async function rolesOf(ctx: ActionContext, userId: string): Promise<string[]> {
  const rows = await db(ctx)
    .select({ roleId: adminUserRole.roleId })
    .from(adminUserRole)
    .where(eq(adminUserRole.userId, userId))
  return rows.map((r) => r.roleId).sort()
}

/** Active owners, locked so two concurrent demotions cannot both pass the check. */
export async function activeOwners(ctx: ActionContext): Promise<string[]> {
  const rows = await db(ctx)
    .select({ id: adminUser.id })
    .from(adminUser)
    .innerJoin(adminUserRole, eq(adminUserRole.userId, adminUser.id))
    .where(and(eq(adminUserRole.roleId, 'owner'), eq(adminUser.disabled, false)))
    .for('update')
  return rows.map((r) => r.id)
}

export async function assertNotLastOwner(ctx: ActionContext, userId: string): Promise<void> {
  const owners = await activeOwners(ctx)
  if (owners.length <= 1 && owners.includes(userId)) {
    throw new ActionError('conflict', 'At least one active owner must remain')
  }
}
