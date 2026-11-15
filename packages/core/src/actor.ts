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

/** A permission set that throws on any change, for actors shared across calls. */
class FrozenSet<T> extends Set<T> {
  #sealed = false

  constructor(values: Iterable<T>) {
    super()
    for (const value of values) super.add(value)
    this.#sealed = true
  }

  override add(value: T): this {
    if (this.#sealed) throw new TypeError('This permission set cannot be changed')
    return super.add(value)
  }

  override delete(): boolean {
    throw new TypeError('This permission set cannot be changed')
  }

  override clear(): void {
    throw new TypeError('This permission set cannot be changed')
  }
}

export const systemActor: Actor = Object.freeze({
  type: 'system',
  id: null,
  permissions: new FrozenSet(['*']),
})

export const guestActor: Actor = Object.freeze({
  type: 'guest',
  id: null,
  permissions: new FrozenSet<string>([]),
})

/** `null` means the action is public. */
export function can(actor: Actor, permission: string | null): boolean {
  if (permission === null || actor.type === 'system') return true
  return actor.permissions.has('*') || actor.permissions.has(permission)
}
