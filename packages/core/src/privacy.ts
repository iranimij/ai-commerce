import { z } from 'zod'
import { defOf, WRAPPERS } from './zod-def.js'

/** How far a value may travel (spec 3g). Unclassified means personal. */
export type PrivacyClass = 'public' | 'internal' | 'personal' | 'secret'

const ORDER: PrivacyClass[] = ['public', 'internal', 'personal', 'secret']

const registry = z.registry<{ privacy: PrivacyClass }>()

/** Marks a schema with a privacy class and returns the same schema. */
export function classify<S extends z.ZodType>(schema: S, privacy: PrivacyClass): S {
  registry.add(schema, { privacy })
  return schema
}

/** The schema's own class, looking through optional, nullable, default and similar wrappers. */
export function privacyOf(schema: z.ZodType): PrivacyClass | undefined {
  let current: unknown = schema
  for (;;) {
    const own = registry.get(current as z.ZodType)?.privacy
    if (own) return own
    const def = defOf(current)
    if (!WRAPPERS.has(def.type)) return undefined
    current = def.innerType
  }
}

function unwrap(schema: unknown): unknown {
  let current = schema
  while (WRAPPERS.has(defOf(current).type)) current = defOf(current).innerType
  return current
}

export interface ModelPolicy {
  /** The owner allows rows of internal data, not only digests. */
  internalRows: boolean
  /** Personal fields the owner allows, as dotted paths with `[]` for array items. */
  personalFields: readonly string[]
}

export interface BoundaryResult {
  value: unknown
  /** Classes of the data that was kept. */
  classes: PrivacyClass[]
  /** Paths that were removed. */
  removed: string[]
}

const join = (path: string, key: string) => (path ? `${path}.${key}` : key)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The only place data is prepared for a model (spec 3g). Removes everything the policy does not
 * allow: secret always, personal unless its path is allowed, internal unless rows are allowed,
 * and any key the schema does not know.
 */
export function toModel(schema: z.ZodType, value: unknown, policy: ModelPolicy): BoundaryResult {
  const classes = new Set<PrivacyClass>()
  const removed = new Set<string>()

  const allowed = (cls: PrivacyClass, path: string): boolean => {
    if (cls === 'public') return true
    if (cls === 'internal') return policy.internalRows
    if (cls === 'personal') return policy.personalFields.includes(path)
    return false
  }

  // Returns [kept, value]; `inherited` is the nearest class above this schema.
  const walk = (
    node: unknown,
    input: unknown,
    path: string,
    inherited: PrivacyClass | undefined,
  ): [boolean, unknown] => {
    const own = privacyOf(node as z.ZodType)
    const cls = inherited === 'secret' ? 'secret' : (own ?? inherited)
    if (cls === 'secret') {
      removed.add(path)
      return [false, undefined]
    }
    const def = defOf(unwrap(node))
    if (def.type === 'object' && isPlainObject(input)) {
      const shape = def.shape as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(input)) {
        const child = shape[key]
        if (child === undefined) {
          removed.add(join(path, key))
          continue
        }
        const [kept, result] = walk(child, item, join(path, key), cls)
        if (kept) out[key] = result
      }
      return [true, out]
    }
    if (def.type === 'array' && Array.isArray(input)) {
      const out: unknown[] = []
      for (const item of input) {
        const [kept, result] = walk(def.element, item, `${path}[]`, cls)
        if (kept) out.push(result)
      }
      return [true, out]
    }
    const effective = cls ?? 'personal'
    if (!allowed(effective, path)) {
      removed.add(path)
      return [false, undefined]
    }
    classes.add(effective)
    return [true, input]
  }

  const [kept, result] = walk(schema, value, '', undefined)
  return {
    value: kept ? result : undefined,
    classes: ORDER.filter((c) => classes.has(c)),
    removed: [...removed],
  }
}
