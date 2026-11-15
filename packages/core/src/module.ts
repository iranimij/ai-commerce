import type { ActionContext, ActionDefinition } from './action.js'
import type { Subscriber } from './events.js'
import type { Step } from './pipeline.js'
import type { ServiceProvision } from './service.js'

/**
 * Runs around an action's handler, after input validation, the permission check and the
 * confirm gate, and before output validation. Lower order is outermost; ties by module name.
 * Call `next` to continue, or return a value to answer without the handler.
 */
export interface ActionWrap {
  action: string
  module: string
  order: number
  wrap: (
    input: never,
    ctx: ActionContext,
    next: (input: unknown) => Promise<unknown>,
  ) => Promise<unknown>
}

export interface ModuleDefinition {
  /** Lower case letters, digits and dashes, starting with a letter. */
  name: string
  depends?: string[]
  /**
   * First segments this module's action names may use. Default: the module name. A namespace
   * belongs to one module only.
   */
  namespaces?: string[]
  // Erased element types: a module's actions and steps each carry their own schema.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions?: ActionDefinition<any, any>[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subscribers?: Subscriber<any>[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps?: Step<any>[]
  wraps?: ActionWrap[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provides?: ServiceProvision<any>[]
}

export function defineModule(def: ModuleDefinition): ModuleDefinition {
  return def
}
