import type { z } from 'zod'
import type { ActionContext, ActionDefinition } from './action.js'
import { can, type Actor, type ActorType } from './actor.js'
import { describeInvalidInput, redactInput, type AuditSink } from './audit.js'
import { ActionError } from './errors.js'
import { createEventBus, type EventBus } from './events.js'
import type { ActionWrap } from './module.js'
import { createPipelines, type Pipelines } from './pipeline.js'
import { fail, type Result } from './result.js'
import type { ServiceDefinition } from './service.js'
import { defOf } from './zod-def.js'

export interface CallOptions {
  actor: Actor
  /** The caller has confirmed a destructive action. */
  confirmed?: boolean
}

export interface Registry {
  register(action: ActionDefinition): void
  /** Adds a wrap around an existing action. Used by `createApp`. */
  addWrap(wrap: ActionWrap): void
  get(name: string): ActionDefinition | undefined
  list(): ActionDefinition[]
  /** Wraps around an action, outermost first. */
  wraps(name: string): { module: string; order: number }[]
  call(name: string, input: unknown, options: CallOptions): Promise<Result<unknown>>
}

export interface RegistryOptions {
  pipelines?: Pipelines
  events?: EventBus
  /** Receives one entry for every call, whatever its outcome. */
  audit?: AuditSink
  /** Reported when the audit sink fails; the call's result is not changed. Default: console.error. */
  onAuditError?: (error: unknown) => void
  /** Reported when a handler throws or returns bad output. Default: console.error. */
  onError?: (error: unknown, info: { action: string; actorType: ActorType }) => void
  /** Runs write and destructive handlers inside a database transaction. */
  transaction?: <T>(fn: () => Promise<T>) => Promise<T>
  /** Resolves services for `ctx.service`. Used by `createApp`. */
  service?: <T>(def: ServiceDefinition<T>) => T
}

const ACTION_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/
const MAX_AUDIT_INPUT = 16_384

/** People and the AI may only run destructive actions after an explicit confirmation. */
function needsConfirmation(action: ActionDefinition, options: CallOptions): boolean {
  const confirmingActor = options.actor.type === 'admin' || options.actor.type === 'customer'
  return action.risk === 'destructive' && confirmingActor && options.confirmed !== true
}

function compareWraps(a: ActionWrap, b: ActionWrap): number {
  return a.order - b.order || a.module.localeCompare(b.module)
}

/**
 * Throws unless every object below the top level rejects unknown keys. Zod's `.strict()` only
 * reaches the top level, and a nested key an AI model invents must not be dropped silently.
 */
function assertNestedStrict(action: string, schema: unknown, path: string, top: boolean): void {
  const def = defOf(schema)
  const at = (child: unknown, childPath: string) => {
    assertNestedStrict(action, child, childPath, false)
  }
  switch (def.type) {
    case 'object':
      if (!top && def.catchall === undefined) {
        throw new Error(
          `Action "${action}" input: the object at "${path}" must be a z.strictObject, so unknown keys are rejected`,
        )
      }
      for (const [key, child] of Object.entries(def.shape as Record<string, unknown>)) {
        at(child, path ? `${path}.${key}` : key)
      }
      return
    case 'array':
      at(def.element, `${path}[]`)
      return
    case 'record':
      at(def.valueType, `${path}[key]`)
      return
    case 'tuple':
      for (const item of def.items as unknown[]) at(item, `${path}[]`)
      if (def.rest) at(def.rest, `${path}[]`)
      return
    case 'union':
      for (const option of def.options as unknown[]) at(option, path)
      return
    case 'intersection':
      at(def.left, path)
      at(def.right, path)
      return
    case 'pipe':
      at(def.in, path)
      return
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'nonoptional':
    case 'readonly':
    case 'catch':
      at(def.innerType, path)
      return
    default:
      return
  }
}

export function createRegistry(options: RegistryOptions = {}): Registry {
  const pipelines = options.pipelines ?? createPipelines()
  const events = options.events ?? createEventBus()
  const onError =
    options.onError ??
    ((error: unknown, info: { action: string }) => {
      console.error(`Action ${info.action} failed`, error)
    })
  const onAuditError =
    options.onAuditError ??
    ((error: unknown) => {
      console.error('Audit write failed', error)
    })
  const service =
    options.service ??
    (<T>(def: ServiceDefinition<T>): T => {
      throw new Error(`Service "${def.name}" is not provided`)
    })
  const actions = new Map<string, ActionDefinition>()
  // Strict copies of each action's input schema, made once at register.
  const inputs = new Map<string, z.ZodType>()
  const wrapsByAction = new Map<string, ActionWrap[]>()

  /** Events a handler emits are delivered after its call ends, and only if it succeeded. */
  function deferredEvents(queue: (() => Promise<void>)[]): EventBus {
    return {
      subscribe: (subscriber) => {
        events.subscribe(subscriber)
      },
      subscribers: (eventName) => events.subscribers(eventName),
      emit(event, payload) {
        const parsed = event.payload.safeParse(payload)
        if (!parsed.success) {
          return Promise.reject(new Error(`Invalid payload for event "${event.name}"`))
        }
        queue.push(() => events.emit(event, parsed.data))
        return Promise.resolve()
      },
    }
  }

  /** The handler with its wraps around it. Input reaching the handler is validated again. */
  function chain(
    action: ActionDefinition,
    schema: z.ZodType,
    ctx: ActionContext,
  ): (input: unknown) => Promise<unknown> {
    const inner = async (input: unknown): Promise<unknown> => {
      const checked = await schema.safeParseAsync(input)
      if (!checked.success) throw new Error('A wrap passed invalid input')
      return action.handler(checked.data as Record<string, unknown>, ctx)
    }
    return (wrapsByAction.get(action.name) ?? []).reduceRight<(input: unknown) => Promise<unknown>>(
      (next, w) => (input) => {
        let called = false
        return w.wrap(input as never, ctx, (nextInput) => {
          if (called) {
            return Promise.reject(
              new Error(`next() called twice by a wrap of module "${w.module}"`),
            )
          }
          called = true
          return next(nextInput)
        })
      },
      inner,
    )
  }

  async function execute(
    name: string,
    input: unknown,
    callOptions: CallOptions,
    queue: (() => Promise<void>)[],
  ): Promise<Result<unknown>> {
    const action = actions.get(name)
    const schema = inputs.get(name)
    if (!action || !schema) return fail('not_found', `Unknown action "${name}"`)

    try {
      const parsed = await schema.safeParseAsync(input)
      if (!parsed.success) return fail('invalid_input', 'Invalid input', parsed.error.issues)

      if (!can(callOptions.actor, action.permission)) {
        return fail('forbidden', `Not allowed to call "${name}"`)
      }
      if (needsConfirmation(action, callOptions)) {
        return fail('confirmation_required', `"${name}" must be confirmed before it runs`)
      }

      // Frozen: a wrap must not change who is calling or what the handler can reach.
      const ctx: ActionContext = Object.freeze({
        actor: callOptions.actor,
        actionName: name,
        pipelines,
        events: deferredEvents(queue),
        service,
        call: async (innerName: string, innerInput: unknown) => {
          // The inner call's events join this call's, so they wait for its commit.
          const inner: (() => Promise<void>)[] = []
          const result = await audited(innerName, innerInput, callOptions, inner)
          if (result.ok) queue.push(...inner)
          return result
        },
      })
      // Output is checked before the transaction ends, so bad output rolls back too.
      const run = async (): Promise<unknown> => {
        const output = await chain(action, schema, ctx)(parsed.data)
        const checked = await action.output.safeParseAsync(output)
        if (!checked.success) throw new Error(`Action "${name}" returned invalid output`)
        return checked.data
      }
      // Reads need no transaction; writes roll back completely if anything throws.
      const output =
        options.transaction && action.risk !== 'read' ? await options.transaction(run) : await run()
      return { ok: true, output }
    } catch (error) {
      queue.length = 0
      if (error instanceof ActionError) return fail(error.code, error.message, error.issues)
      onError(error, { action: name, actorType: callOptions.actor.type })
      // The error may hold internals; callers get a generic message.
      return fail('handler_error', 'Action failed')
    }
  }

  function auditInput(name: string, input: unknown, result: Result<unknown>): unknown {
    const action = actions.get(name)
    if (!action) return {}
    if (!result.ok && result.error.code === 'invalid_input') return describeInvalidInput(input)
    const redacted = redactInput(input, action.redact ?? [])
    try {
      return JSON.stringify(redacted).length > MAX_AUDIT_INPUT ? '[input too large]' : redacted
    } catch {
      return '[unstorable input]'
    }
  }

  async function audit(
    name: string,
    input: unknown,
    callOptions: CallOptions,
    result: Result<unknown>,
    durationMs: number,
  ): Promise<void> {
    if (!options.audit) return
    const { actor } = callOptions
    try {
      await options.audit.write({
        actorType: actor.type,
        actorId: actor.id,
        onBehalfOf: actor.onBehalfOf ?? null,
        action: name,
        input: auditInput(name, input, result),
        outcome: result.ok ? 'ok' : result.error.code,
        durationMs,
      })
    } catch (error) {
      // The action already happened; failing the call now could make a caller repeat it.
      onAuditError(error)
    }
  }

  async function audited(
    name: string,
    input: unknown,
    callOptions: CallOptions,
    queue: (() => Promise<void>)[],
  ): Promise<Result<unknown>> {
    const started = performance.now()
    const result = await execute(name, input, callOptions, queue)
    await audit(name, input, callOptions, result, Math.round(performance.now() - started))
    return result
  }

  return {
    register(action) {
      if (!ACTION_NAME.test(action.name)) {
        throw new Error(
          `Invalid action name "${action.name}": expected "module.verb" in lower case`,
        )
      }
      if (actions.has(action.name)) {
        throw new Error(`Action "${action.name}" is already registered`)
      }
      assertNestedStrict(action.name, action.input, '', true)
      actions.set(action.name, action)
      inputs.set(action.name, action.input.strict())
    },

    addWrap(wrap) {
      if (!actions.has(wrap.action)) {
        throw new Error(`Module "${wrap.module}" wraps unknown action "${wrap.action}"`)
      }
      const list = wrapsByAction.get(wrap.action) ?? []
      list.push(wrap)
      list.sort(compareWraps)
      wrapsByAction.set(wrap.action, list)
    },

    get: (name) => actions.get(name),

    list: () => [...actions.values()],

    wraps: (name) =>
      (wrapsByAction.get(name) ?? []).map((w) => ({ module: w.module, order: w.order })),

    async call(name, input, callOptions) {
      const queue: (() => Promise<void>)[] = []
      const result = await audited(name, input, callOptions, queue)
      // After commit and audit (spec 4.3): a failing subscriber can no longer undo the action.
      for (const deliver of queue) await deliver()
      return result
    },
  }
}
