/** Zod 4 keeps a schema's structure in `_zod.def`; the walkers below read it. */
export type Def = Record<string, unknown> & { type: string }

export const defOf = (schema: unknown): Def => (schema as { _zod: { def: Def } })._zod.def

/** Wrapper kinds whose `innerType` holds the real schema. */
export const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'nonoptional',
  'readonly',
  'catch',
])
