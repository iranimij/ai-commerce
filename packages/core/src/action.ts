import type { z } from 'zod'
import type { Actor } from './actor.js'
import type { EventBus } from './events.js'
import type { Pipelines } from './pipeline.js'

export type Risk = 'read' | 'write' | 'destructive'

export interface ActionContext {
  actor: Actor
  actionName: string
  /** Run another module's extension points from inside a handler. */
  pipelines: Pipelines
  events: EventBus
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
