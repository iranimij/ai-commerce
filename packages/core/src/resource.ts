import { z } from 'zod'
import type { ActionContext, ActionDefinition, Risk } from './action.js'
import type { Actor, ActorType } from './actor.js'
import {
  appInfo,
  attributeStore,
  checkAttributeValues,
  visibleAttributes,
  type AttributeDefinition,
} from './attributes.js'
import { ActionError } from './errors.js'
import { classify, privacyOf } from './privacy.js'
import { defineService } from './service.js'
import { defOf, WRAPPERS } from './zod-def.js'

export interface ResourcePermissions {
  /** `null` makes list, get and history public. */
  read: string | null
  write: string
  delete: string
}

export interface ResourceDefinition<F extends z.ZodObject = z.ZodObject> {
  /** Lower case letters, digits and dashes; also the namespace of its actions. */
  name: string
  module: string
  label: { singular: string; plural: string }
  /**
   * The record's own fields, as a `z.strictObject`. Use `.optional()` for a field that may be
   * absent, not `.nullable()`: an empty column is returned as a missing key.
   */
  fields: F
  table: string
  permissions: ResourcePermissions
  /** Accepts merchant and module attributes (Task 5). */
  attributes: boolean
}

export interface ResourceInput<F extends z.ZodObject> {
  name: string
  module: string
  label: { singular: string; plural: string }
  fields: F
  /** Default: `<module>_<name>`, dashes as underscores. */
  table?: string
  permissions?: Partial<ResourcePermissions>
  attributes?: boolean
}

export type ResourceRecord = {
  id: string
  version: number
  createdAt: string
  updatedAt: string
  attributes: Record<string, unknown>
} & Record<string, unknown>

export interface Revision {
  id: string
  resource: string
  recordId: string
  /** The record's version after this change; `null` for a delete. */
  version: number | null
  action: string
  actorType: ActorType
  actorId: string | null
  onBehalfOf: string | null
  at: string
  before: ResourceRecord | null
  after: ResourceRecord | null
}

export interface ListQuery {
  filter?: Record<string, unknown>
  attributes?: Record<string, unknown>
  cursor?: string
  limit: number
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
}

export interface WriteMeta {
  action: string
  actor: Actor
}

/** Storage for resources. Every write also records a revision in the same transaction. */
export interface ResourceStore {
  list(resource: ResourceDefinition, query: ListQuery): Promise<Page<ResourceRecord>>
  get(resource: ResourceDefinition, id: string): Promise<ResourceRecord | null>
  create(
    resource: ResourceDefinition,
    values: Record<string, unknown>,
    attributes: Record<string, unknown>,
    meta: WriteMeta,
  ): Promise<ResourceRecord>
  /** Throws `ActionError` `not_found` or `conflict`. An attribute set to null is removed. */
  update(
    resource: ResourceDefinition,
    id: string,
    expectedVersion: number,
    values: Record<string, unknown>,
    attributes: Record<string, unknown> | undefined,
    meta: WriteMeta,
  ): Promise<ResourceRecord>
  delete(
    resource: ResourceDefinition,
    id: string,
    expectedVersion: number,
    meta: WriteMeta,
  ): Promise<void>
  history(
    resource: ResourceDefinition,
    id: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Page<Revision>>
  revision(resource: ResourceDefinition, revisionId: string): Promise<Revision | null>
  /** `expected` is the version read; it must be absent when the record was deleted. */
  restore(
    resource: ResourceDefinition,
    revision: Revision,
    expected: number | undefined,
    meta: WriteMeta,
  ): Promise<ResourceRecord>
}

export const resourceStore = defineService<ResourceStore>('core.resource-store')

const RESOURCE_NAME = /^[a-z][a-z0-9-]*$/
const SYSTEM_FIELDS = new Set(['id', 'version', 'createdAt', 'updatedAt', 'attributes'])
const SCALARS = new Set(['string', 'number', 'boolean', 'enum'])

export function defineResource<F extends z.ZodObject>(
  def: ResourceInput<F>,
): ResourceDefinition<F> {
  if (!RESOURCE_NAME.test(def.name)) throw new Error(`Invalid resource name "${def.name}"`)
  if (defOf(def.fields).catchall === undefined) {
    throw new Error(`Resource "${def.name}" fields must be a z.strictObject`)
  }
  for (const [key, schema] of Object.entries(def.fields.shape)) {
    if (SYSTEM_FIELDS.has(key)) throw new Error(`Resource "${def.name}" field "${key}" is reserved`)
    if (privacyOf(schema as z.ZodType) === 'secret') {
      throw new Error(`Resource "${def.name}" field "${key}" is secret; store secrets as settings`)
    }
  }
  return {
    name: def.name,
    module: def.module,
    label: def.label,
    fields: def.fields,
    table: def.table ?? `${def.module}_${def.name}`.replaceAll('-', '_'),
    permissions: {
      read: def.permissions?.read === undefined ? `${def.name}.read` : def.permissions.read,
      write: def.permissions?.write ?? `${def.name}.write`,
      delete: def.permissions?.delete ?? `${def.name}.delete`,
    },
    attributes: def.attributes ?? false,
  }
}

function unwrap(schema: unknown): unknown {
  let current = schema
  while (WRAPPERS.has(defOf(current).type)) current = defOf(current).innerType
  return current
}

/** Every field optional and without its default, so an update only writes what it was given. */
function patchSchema(fields: z.ZodObject): z.ZodObject {
  const shape: Record<string, z.ZodType> = {}
  for (const [key, schema] of Object.entries(fields.shape)) {
    let inner = schema as z.ZodType
    const type = defOf(inner).type
    if (type === 'default' || type === 'prefault') inner = defOf(inner).innerType as z.ZodType
    shape[key] = inner.optional()
  }
  return z.strictObject(shape)
}

/** Equality filters on the scalar fields. */
function filterSchema(fields: z.ZodObject): z.ZodObject {
  const shape: Record<string, z.ZodType> = {}
  for (const [key, schema] of Object.entries(fields.shape)) {
    const base = unwrap(schema) as z.ZodType
    if (SCALARS.has(defOf(base).type)) shape[key] = base.optional()
  }
  return z.strictObject(shape)
}

const pub = <S extends z.ZodType>(schema: S) => classify(schema, 'public')

function recordSchema(resource: ResourceDefinition): z.ZodType {
  return resource.fields.extend({
    id: pub(z.string()),
    version: pub(z.number().int()),
    createdAt: pub(z.string()),
    updatedAt: pub(z.string()),
    attributes: z.record(z.string(), z.unknown()),
  })
}

const revisionSchema = z.object({
  id: pub(z.string()),
  resource: pub(z.string()),
  recordId: pub(z.string()),
  version: pub(z.number().int().nullable()),
  action: pub(z.string()),
  actorType: pub(z.string()),
  actorId: z.string().nullable(),
  onBehalfOf: z.string().nullable(),
  at: pub(z.string()),
  // Snapshots of older field sets must stay readable, so they are not checked against today's.
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
})

const page = (item: z.ZodType) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() })

/** The seven actions every resource gets. */
export function resourceActions(resource: ResourceDefinition): ActionDefinition[] {
  const { name, label, permissions } = resource
  const record = recordSchema(resource)
  const id = z.uuid()
  const version = z.number().int().min(1)
  const limit = z.number().int().min(1).max(200).default(50)
  const cursor = z.string().max(500).optional()
  const attributes = resource.attributes
    ? { attributes: z.record(z.string(), z.unknown()).optional() }
    : {}
  const store = (ctx: ActionContext) => ctx.service(resourceStore)
  const meta = (ctx: ActionContext) => ({ action: ctx.actionName, actor: ctx.actor })
  // shortcut: definitions are read on every call; add a cache with invalidation once profiling shows the need (M1).
  const defsOf = async (ctx: ActionContext): Promise<AttributeDefinition[]> =>
    resource.attributes
      ? [
          ...ctx.service(appInfo).moduleAttributes(name),
          ...(await ctx.service(attributeStore).list(name)),
        ]
      : []
  const show = (defs: AttributeDefinition[], rec: ResourceRecord): ResourceRecord => ({
    ...rec,
    attributes: visibleAttributes(defs, rec.attributes),
  })
  const given = (input: Record<string, unknown>) =>
    input.attributes as Record<string, unknown> | undefined

  const action = (
    verb: string,
    description: string,
    risk: Risk,
    permission: string | null,
    input: z.ZodObject,
    output: z.ZodType,
    handler: (input: Record<string, unknown>, ctx: ActionContext) => Promise<unknown>,
  ): ActionDefinition => ({
    name: `${name}.${verb}`,
    description,
    risk,
    permission,
    input,
    output,
    handler,
  })

  return [
    action(
      'list',
      `List ${label.plural.toLowerCase()}`,
      'read',
      permissions.read,
      z.object({ filter: filterSchema(resource.fields).optional(), ...attributes, cursor, limit }),
      page(record),
      async (input, ctx) => {
        const defs = await defsOf(ctx)
        const filter = given(input) && checkAttributeValues(defs, given(input), 'filter')
        const found = await store(ctx).list(resource, {
          ...(input.filter ? { filter: input.filter as Record<string, unknown> } : {}),
          ...(filter ? { attributes: filter } : {}),
          ...(input.cursor ? { cursor: input.cursor as string } : {}),
          limit: input.limit as number,
        })
        return { ...found, items: found.items.map((r) => show(defs, r)) }
      },
    ),
    action(
      'get',
      `Get one ${label.singular.toLowerCase()}`,
      'read',
      permissions.read,
      z.object({ id }),
      record,
      async (input, ctx) => {
        const found = await store(ctx).get(resource, input.id as string)
        if (!found) throw new ActionError('not_found', `${label.singular} not found`)
        return show(await defsOf(ctx), found)
      },
    ),
    action(
      'create',
      `Create a ${label.singular.toLowerCase()}`,
      'write',
      permissions.write,
      z.object({ values: resource.fields, ...attributes }),
      record,
      async (input, ctx) => {
        const defs = await defsOf(ctx)
        const attrs = checkAttributeValues(defs, given(input), 'create')
        const created = await store(ctx).create(
          resource,
          input.values as Record<string, unknown>,
          attrs,
          meta(ctx),
        )
        return show(defs, created)
      },
    ),
    action(
      'update',
      `Update a ${label.singular.toLowerCase()}`,
      'write',
      permissions.write,
      z.object({ id, version, values: patchSchema(resource.fields), ...attributes }),
      record,
      async (input, ctx) => {
        const values = input.values as Record<string, unknown>
        const defs = await defsOf(ctx)
        const attrs = given(input) && checkAttributeValues(defs, given(input), 'update')
        if (
          Object.keys(values).length === 0 &&
          (attrs === undefined || Object.keys(attrs).length === 0)
        ) {
          throw new ActionError('invalid_input', 'Nothing to update')
        }
        const updated = await store(ctx).update(
          resource,
          input.id as string,
          input.version as number,
          values,
          attrs,
          meta(ctx),
        )
        return show(defs, updated)
      },
    ),
    action(
      'delete',
      `Delete a ${label.singular.toLowerCase()}`,
      'destructive',
      permissions.delete,
      z.object({ id, version }),
      z.object({}),
      async (input, ctx) => {
        await store(ctx).delete(resource, input.id as string, input.version as number, meta(ctx))
        return {}
      },
    ),
    action(
      'history',
      `List the changes to a ${label.singular.toLowerCase()}, newest first`,
      'read',
      permissions.read,
      z.object({ id, cursor, limit }),
      page(revisionSchema),
      (input, ctx) =>
        store(ctx).history(
          resource,
          input.id as string,
          input.cursor as string | undefined,
          input.limit as number,
        ),
    ),
    action(
      'restore',
      `Restore a ${label.singular.toLowerCase()} to how it was after a change`,
      'write',
      permissions.write,
      z.object({
        revisionId: z.string().regex(/^\d{1,19}$/),
        /** The version you read; leave it out to bring back a deleted record. */
        version: z.number().int().positive().optional(),
      }),
      record,
      async (input, ctx) => {
        const revision = await store(ctx).revision(resource, input.revisionId as string)
        if (!revision) throw new ActionError('not_found', 'Revision not found')
        const restored = await store(ctx).restore(
          resource,
          revision,
          input.version as number | undefined,
          meta(ctx),
        )
        return show(await defsOf(ctx), restored)
      },
    ),
  ]
}
