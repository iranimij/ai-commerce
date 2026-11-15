import type { ActionContext, ActionDefinition } from './action.js'
import { can, type Actor } from './actor.js'
import { createEventBus, type EventBus } from './events.js'
import type { ActionWrap } from './module.js'
import { createPipelines, type Pipelines } from './pipeline.js'
import { fail, type Result } from './result.js'

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
}

const ACTION_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/

/** People and the AI may only run destructive actions after an explicit confirmation. */
function needsConfirmation(action: ActionDefinition, options: CallOptions): boolean {
  const confirmingActor = options.actor.type === 'admin' || options.actor.type === 'customer'
  return action.risk === 'destructive' && confirmingActor && options.confirmed !== true
}

function compareWraps(a: ActionWrap, b: ActionWrap): number {
  return a.order - b.order || a.module.localeCompare(b.module)
}

class OutputInvalid extends Error {}

export function createRegistry(options: RegistryOptions = {}): Registry {
  const pipelines = options.pipelines ?? createPipelines()
  const events = options.events ?? createEventBus()
  const actions = new Map<string, ActionDefinition>()
  const wrapsByAction = new Map<string, ActionWrap[]>()

  /** Builds handler-with-wraps; the input reaching the handler is validated again. */
  function chain(
    action: ActionDefinition,
    ctx: ActionContext,
  ): (input: unknown) => Promise<unknown> {
    const inner = async (input: unknown): Promise<unknown> => {
      const checked = action.input.strict().safeParse(input)
      if (!checked.success) throw new OutputInvalid('A wrap passed invalid input')
      return action.handler(checked.data, ctx)
    }
    const wraps = wrapsByAction.get(action.name) ?? []
    return wraps.reduceRight<(input: unknown) => Promise<unknown>>(
      (next, w) => (input) => w.wrap(input as never, ctx, next),
      inner,
    )
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
      actions.set(action.name, action)
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
      const action = actions.get(name)
      if (!action) return fail('not_found', `Unknown action "${name}"`)

      // Strict: unknown keys are rejected, never silently dropped.
      const parsed = action.input.strict().safeParse(input)
      if (!parsed.success) return fail('invalid_input', 'Invalid input', parsed.error.issues)

      if (!can(callOptions.actor, action.permission)) {
        return fail('forbidden', `Not allowed to call "${name}"`)
      }
      if (needsConfirmation(action, callOptions)) {
        return fail('confirmation_required', `"${name}" must be confirmed before it runs`)
      }

      const ctx: ActionContext = { actor: callOptions.actor, actionName: name, pipelines, events }
      try {
        const output = await chain(action, ctx)(parsed.data)
        const checked = action.output.safeParse(output)
        if (!checked.success) return fail('handler_error', 'Action failed')
        return { ok: true, output: checked.data }
      } catch {
        // The handler's message may hold internals; callers get a generic one.
        return fail('handler_error', 'Action failed')
      }
    },
  }
}
