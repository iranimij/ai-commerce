import { z } from 'zod'
import { ActionError } from './errors.js'
import type { PrivacyClass } from './privacy.js'
import type { ResourceDefinition } from './resource.js'
import type { SettingDefinition } from './settings.js'
import { defineService } from './service.js'

export type AttributeType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect'

export interface AttributeDefinition {
  resource: string
  code: string
  label: string
  type: AttributeType
  options?: string[]
  required: boolean
  privacy: Exclude<PrivacyClass, 'secret'>
  /** Module attributes come with code and cannot be deleted by a merchant. */
  source: 'module' | 'merchant'
  /** The module that defines it, for module attributes. */
  module?: string
}

const SELECT_TYPES = new Set<AttributeType>(['select', 'multiselect'])

/** What a merchant or a module gives to define an attribute. */
export const attributeInput = z
  .strictObject({
    resource: z.string().regex(/^[a-z][a-z0-9-]*$/),
    code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    label: z.string().min(1).max(200),
    type: z.enum(['text', 'number', 'boolean', 'date', 'select', 'multiselect']),
    options: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(500)
      .refine((o) => new Set(o).size === o.length, 'Options must be unique')
      .optional(),
    required: z.boolean().default(false),
    privacy: z.enum(['public', 'internal', 'personal']).default('personal'),
  })
  .refine((a) => SELECT_TYPES.has(a.type) === (a.options !== undefined), {
    message: 'Options are required for select types and only allowed for them',
    path: ['options'],
  })

export type AttributeInput = z.input<typeof attributeInput>

export function defineAttribute(input: AttributeInput): AttributeDefinition {
  const parsed = attributeInput.parse(input)
  return { ...stripUndefined(parsed), source: 'module' }
}

function stripUndefined<T extends { options?: string[] | undefined }>(value: T) {
  const { options, ...rest } = value
  return options === undefined ? rest : { ...rest, options }
}

/** Builds a merchant attribute from validated input. */
export function merchantAttribute(input: z.output<typeof attributeInput>): AttributeDefinition {
  return { ...stripUndefined(input), source: 'merchant' }
}

/** The schema a stored value must match. */
export function attributeValueSchema(def: AttributeDefinition): z.ZodType {
  const options = (def.options ?? []) as [string, ...string[]]
  switch (def.type) {
    case 'text':
      return z.string().max(10_000)
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'date':
      return z.iso.date()
    case 'select':
      return z.enum(options)
    case 'multiselect':
      return z
        .array(z.enum(options))
        .refine((v) => new Set(v).size === v.length, 'Values must be unique')
  }
}

/** Merchant-created attribute definitions. */
export interface AttributeStore {
  list(resource: string): Promise<AttributeDefinition[]>
  /** Throws `ActionError` `conflict` for a code that exists. */
  create(def: AttributeDefinition): Promise<void>
  /** Returns false when there was nothing to delete. */
  delete(resource: string, code: string): Promise<boolean>
}

export const attributeStore = defineService<AttributeStore>('core.attribute-store')

/** What the running app is made of. Provided by `createApp` itself. */
export interface AppInfo {
  /** Resources of the enabled modules. */
  resources(): ResourceDefinition[]
  /** Attributes defined by enabled modules for a resource. */
  moduleAttributes(resource: string): AttributeDefinition[]
  /** Sorted, unique permissions of every enabled action and setting. */
  permissions(): string[]
  /** Setting definitions of the enabled modules. */
  settings(): SettingDefinition[]
  /** Every module the app knows, enabled or not, in the order given to `createApp`. */
  modules(): KnownModule[]
  /** Names of the enabled modules in this app, in load order. */
  enabledModules(): string[]
}

export interface KnownModule {
  name: string
  label: string
  description: string
  required: boolean
  depends: string[]
}

export const appInfo = defineService<AppInfo>('core.app-info')

type Issue = z.core.$ZodIssue
const issue = (code: string, message: string): Issue => ({
  code: 'custom',
  path: ['attributes', code],
  message,
  input: undefined,
})

/**
 * Checks attribute values against their definitions. `create` drops nulls and needs every
 * required attribute; `update` keeps null as "remove"; `filter` allows neither nulls nor checks
 * for required ones.
 */
export function checkAttributeValues(
  defs: readonly AttributeDefinition[],
  values: Record<string, unknown> | undefined,
  mode: 'create' | 'update' | 'filter',
): Record<string, unknown> {
  const byCode = new Map(defs.map((d) => [d.code, d]))
  const issues: Issue[] = []
  const out: Record<string, unknown> = {}
  for (const [code, value] of Object.entries(values ?? {})) {
    const def = byCode.get(code)
    if (!def) {
      issues.push(issue(code, `Unknown attribute "${code}"`))
      continue
    }
    if (value === null) {
      if (def.required) issues.push(issue(code, `Attribute "${code}" is required`))
      else if (mode === 'update') out[code] = null
      else if (mode === 'filter') issues.push(issue(code, `Attribute "${code}" cannot be null`))
      continue
    }
    const result = attributeValueSchema(def).safeParse(value)
    if (result.success) out[code] = result.data
    else
      issues.push(
        ...result.error.issues.map((i) => ({ ...i, path: ['attributes', code, ...i.path] })),
      )
  }
  if (mode === 'create') {
    for (const def of defs) {
      if (def.required && !(def.code in out) && !issues.some((i) => i.path[1] === def.code)) {
        issues.push(issue(def.code, `Attribute "${def.code}" is required`))
      }
    }
  }
  if (issues.length > 0) throw new ActionError('invalid_input', 'Invalid attributes', issues)
  return out
}

/** Leaves out stored values whose attribute no longer exists or no longer validates. */
export function visibleAttributes(
  defs: readonly AttributeDefinition[],
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const def of defs) {
    const value = stored[def.code]
    if (value !== undefined && attributeValueSchema(def).safeParse(value).success) {
      out[def.code] = value
    }
  }
  return out
}
