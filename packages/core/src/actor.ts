export type ActorType = 'guest' | 'customer' | 'admin' | 'token' | 'system'

/** Who is making a call. Every call has exactly one actor. */
export interface Actor {
  type: ActorType
  id: string | null
  /** Permission names; '*' grants everything. */
  permissions: ReadonlySet<string>
  /** Set when the AI acts for an admin: that admin's id. */
  onBehalfOf?: string
}

export const systemActor: Actor = Object.freeze({
  type: 'system',
  id: null,
  permissions: new Set<string>(['*']),
})

export const guestActor: Actor = Object.freeze({
  type: 'guest',
  id: null,
  permissions: new Set<string>(),
})

/** `null` means the action is public. */
export function can(actor: Actor, permission: string | null): boolean {
  if (permission === null || actor.type === 'system') return true
  return actor.permissions.has('*') || actor.permissions.has(permission)
}
