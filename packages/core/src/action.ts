import type { z } from 'zod'
import type { Actor } from './actor.js'
import type { EventBus } from './events.js'
import type { Pipelines } from './pipeline.js'
import type { Result } from './result.js'
import type { ServiceDefinition } from './service.js'

export type Risk = 'read' | 'write' | 'destructive'

export interface ActionContext {
  actor: Actor
  actionName: string
  /** Run another module's extension points from inside a handler. */
  pipelines: Pipelines
  events: EventBus
  /** The implementation of a service; throws if no enabled module or default provides it. */
  service: <T>(def: ServiceDefinition<T>) => T
  /**
   * Runs another action as the same caller, with the same confirmation, inside this call's
   * transaction (a savepoint, so its failure undoes only its own writes). It is audited on its
   * own; its events wait for this call to succeed.
   */
  call: (name: string, input: unknown) => Promise<Result<unknown>>
}

export interface ActionDefinition<
  I extends z.ZodObject = z.ZodObject,
  O extends z.ZodType = z.ZodType,
> {
  /** 'module.verb', lower case, dot separated, e.g. 'order.refund'. */
  name: string
  /** Plain-language description; shown to people and to the AI. */
  description: string
  input: I
  output: O
  /** Permission required to call it; `null` means public. */
  permission: string | null
  risk: Risk
  /** Input keys whose values are never written to the audit log. */
  redact?: (keyof z.infer<I> & string)[]
  handler: (input: z.infer<I>, ctx: ActionContext) => Promise<z.infer<O>>
}

export function defineAction<I extends z.ZodObject, O extends z.ZodType>(
  def: ActionDefinition<I, O>,
): ActionDefinition<I, O> {
  return def
}
