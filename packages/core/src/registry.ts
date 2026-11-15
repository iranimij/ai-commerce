import type { ActionDefinition } from './action.js'
import { can, type Actor } from './actor.js'
import { fail, type Result } from './result.js'

export interface CallOptions {
  actor: Actor
  /** The caller has confirmed a destructive action. */
  confirmed?: boolean
}

export interface Registry {
  register(action: ActionDefinition): void
  get(name: string): ActionDefinition | undefined
  list(): ActionDefinition[]
  call(name: string, input: unknown, options: CallOptions): Promise<Result<unknown>>
}

const ACTION_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/

/** People and the AI may only run destructive actions after an explicit confirmation. */
function needsConfirmation(action: ActionDefinition, options: CallOptions): boolean {
  const confirmingActor = options.actor.type === 'admin' || options.actor.type === 'customer'
  return action.risk === 'destructive' && confirmingActor && options.confirmed !== true
}

export function createRegistry(): Registry {
  const actions = new Map<string, ActionDefinition>()

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

    get: (name) => actions.get(name),

    list: () => [...actions.values()],

    async call(name, input, options) {
      const action = actions.get(name)
      if (!action) return fail('not_found', `Unknown action "${name}"`)

      // Strict: unknown keys are rejected, never silently dropped.
      const parsed = action.input.strict().safeParse(input)
      if (!parsed.success) return fail('invalid_input', 'Invalid input', parsed.error.issues)

      if (!can(options.actor, action.permission)) {
        return fail('forbidden', `Not allowed to call "${name}"`)
      }
      if (needsConfirmation(action, options)) {
        return fail('confirmation_required', `"${name}" must be confirmed before it runs`)
      }

      try {
        const output: unknown = await action.handler(parsed.data, {
          actor: options.actor,
          actionName: name,
        })
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
